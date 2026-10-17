// Read-only entry point. Neither this module nor its helper imports migrations.
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  ConnectionSafetyRefusal, assertSafe, protectedProject, verifiedTlsOptions,
  assertVerifiedClientTls, inspectBackendTls, configureBoundedSession,
  beginBoundedTransaction,
} from "./fresh-connection-safety.mjs";

const approvedTargets = new WeakSet();
const output = (check, status, detail) => console.log(JSON.stringify({ check, status, detail }));
const identifier = name => `"${name.replaceAll('"', '""')}"`;

export function approvePreflightTarget(args, env) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    assertSafe(["--read-only", "--check", "--project-ref", "--approve-project-ref",
      "--acknowledge-pooler-tls-boundary"].includes(flag) && !(flag in options), "INVALID_ARGUMENTS");
    if (["--read-only", "--check", "--acknowledge-pooler-tls-boundary"].includes(flag)) options[flag] = true;
    else {
      assertSafe(args[index + 1] && !args[index + 1].startsWith("--"), "INVALID_ARGUMENTS");
      options[flag] = args[++index];
    }
  }
  const ref = options["--project-ref"];
  assertSafe(ref !== protectedProject && options["--approve-project-ref"] !== protectedProject,
    "PROTECTED_PROJECT");
  assertSafe(Boolean(options["--check"]) !== Boolean(options["--read-only"]), "EXPLICIT_READ_ONLY_ACTION_REQUIRED");
  assertSafe(typeof ref === "string" && /^[a-z0-9]{20}$/.test(ref)
    && ref === options["--approve-project-ref"], "EXACT_PROJECT_APPROVAL_REQUIRED");
  assertSafe(typeof env.FRESH_DB_URL === "string" && env.FRESH_DB_URL.length > 0,
    "EXPLICIT_CONNECTION_REQUIRED");
  assertSafe(!env.FRESH_DB_URL.includes(protectedProject)
    && !env.FRESH_SUPABASE_URL?.includes(protectedProject), "PROTECTED_PROJECT");
  assertSafe(env.FRESH_SUPABASE_URL === `https://${ref}.supabase.co`, "API_PROJECT_MISMATCH");
  let url, user, password, database;
  try {
    url = new URL(env.FRESH_DB_URL);
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new ConnectionSafetyRefusal("INVALID_CONNECTION");
  }
  assertSafe(["postgres:", "postgresql:"].includes(url.protocol) && !url.search && !url.hash,
    "UNSUPPORTED_CONNECTION_OPTIONS");
  const direct = url.hostname === `db.${ref}.supabase.co` && user === "postgres";
  const pooler = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && user === `postgres.${ref}`;
  assertSafe((direct || pooler) && Number(url.port || 5432) === 5432
    && database === "postgres" && password.length > 0, "CONNECTION_PROJECT_MISMATCH");
  const acknowledgedPoolerBoundary = options["--acknowledge-pooler-tls-boundary"] === true;
  assertSafe(!pooler || acknowledgedPoolerBoundary, "POOLER_TLS_BOUNDARY_ACK_REQUIRED");
  assertSafe(pooler || !acknowledgedPoolerBoundary, "POOLER_ACK_NOT_APPLICABLE");
  const target = Object.freeze({
    ref, connectionMode: direct ? "direct" : "session-pooler",
    acknowledgedPoolerBoundary, checkOnly: options["--check"] === true,
    config: Object.freeze({
      host: url.hostname, port: 5432, user, password, database,
      ssl: verifiedTlsOptions(url.hostname, env),
      application_name: "alb-read-only-preflight", connectionTimeoutMillis: 8000,
      query_timeout: 15000,
      options: "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=20000",
    }),
  });
  approvedTargets.add(target);
  return target;
}

export async function runReadOnlyPreflight({ target, report = output, Client = pg.Client }) {
  assertSafe(approvedTargets.has(target) && !target.checkOnly, "READ_ONLY_TARGET_NOT_APPROVED");
  const client = new Client(target.config);
  client.on("error", () => {});
  client.on("notice", () => {});
  let connected = false;
  let rolledBack = false;
  const requireCheck = (check, condition, detail) => {
    report(check, condition ? "PASS" : "FAIL", detail);
    assertSafe(condition, "PREFLIGHT_CHECK_FAILED");
  };
  const read = sql => {
    assertSafe((sql.startsWith("SELECT ") || sql === "ROLLBACK") && !sql.includes(";"),
      "READ_ONLY_SQL_REFUSED");
    return client.query(sql);
  };
  try {
    // Exactly one attempt. No alternate endpoints, reconnects or env fallbacks.
    await client.connect();
    connected = true;
    assertVerifiedClientTls(client, target.config.host);
    report("Client certificate and hostname verification", "PASS", "Verified external TLS socket");
    await configureBoundedSession(client, true);
    await beginBoundedTransaction(client, true);
    report("Read-only session, transaction and server timeouts", "PASS", {
      readOnly: true, statementTimeout: "15s", lockTimeout: "3s", idleTimeout: "20s",
    });
    const identity = (await read(`SELECT current_database() AS database,
      current_user AS role, session_user AS session_role,
      current_setting('server_version_num')::int AS version,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS backend_tls`)).rows[0];
    requireCheck("Database identity and PostgreSQL version", identity?.database === "postgres"
      && identity.role === "postgres" && identity.session_role === "postgres" && identity.version >= 170000,
    "Expected database/role and PostgreSQL 17+");
    const transport = inspectBackendTls(target.connectionMode, identity.backend_tls, target.acknowledgedPoolerBoundary);
    report("TLS boundary policy", "PASS", transport);
    report("Pooler-to-database encryption", transport.upstreamEncryptionVerified ? "PASS" : "NOT VERIFIED",
      transport.upstreamEncryptionVerified ? "Backend reports TLS" : "Backend reports no TLS; explicit pooler boundary acknowledgement, not an encryption claim");

    const allowed = ["public", "drizzle", "auth", "storage", "extensions", "graphql", "graphql_public",
      "realtime", "_realtime", "supabase_functions", "supabase_migrations", "vault", "pgsodium",
      "pgsodium_masks", "cron", "net"];
    const schemas = (await read("SELECT nspname AS name FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'")).rows;
    requireCheck("Managed schema allowlist", schemas.every(row => allowed.includes(row.name)), { count: schemas.length });
    const publicObjects = (await read(`SELECT 'relation' AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' UNION ALL SELECT 'function' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
      UNION ALL SELECT 'type' FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typtype IN ('e','d','c')`)).rows;
    requireCheck("Empty application schema", publicObjects.length === 0, { unexpectedObjects: publicObjects.length });
    const drizzle = (await read(`SELECT 'relation' FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='drizzle'
      UNION ALL SELECT 'function' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='drizzle'
      UNION ALL SELECT 'type' FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='drizzle' AND t.typtype IN ('e','d','c')`)).rows;
    requireCheck("No existing Drizzle history or objects", drizzle.length === 0, { objects: drizzle.length });
    const history = (await read(`SELECT c.relname AS name,c.relkind,has_table_privilege(current_user,c.oid,'SELECT') AS can_read,
      row_security_active(c.oid) AS filtered FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='supabase_migrations' AND c.relkind IN ('r','p','v','m','f')`)).rows;
    for (const row of history) {
      requireCheck("Migration history inspection permission", ["r", "p"].includes(row.relkind)
        && row.can_read && !row.filtered, "Readable base table without RLS filtering required");
      const count = (await read(`SELECT count(*)::text AS count FROM supabase_migrations.${identifier(row.name)}`)).rows[0].count;
      requireCheck("Empty managed migration history", count === "0", { count });
    }
    if (!history.length) report("Empty managed migration history", "PASS", "No history relations");
    const triggers = (await read(`SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND NOT t.tgisinternal`)).rows;
    requireCheck("No custom Auth triggers", triggers.length === 0, { count: triggers.length });
    const roles = (await read("SELECT rolname FROM pg_roles WHERE rolname IN ('postgres','anon','authenticated','service_role')")).rows;
    requireCheck("Required Supabase roles", roles.length === 4, { count: roles.length });
    const uid = (await read(`SELECT has_function_privilege(current_user,p.oid,'EXECUTE') AS executable
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='auth' AND p.proname='uid' AND p.pronargs=0 AND p.prorettype='uuid'::regtype`)).rows;
    requireCheck("auth.uid() and execution privilege", uid.length === 1 && uid[0].executable, "UUID-returning helper required");
    const columns = (await read(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a
      WHERE a.attrelid=to_regclass('auth.users') AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname IN ('id','email','raw_user_meta_data','created_at')`)).rows;
    requireCheck("Required Auth columns", columns.length === 4
      && columns.some(row => row.name === "id" && row.type === "uuid")
      && columns.some(row => row.name === "raw_user_meta_data" && row.type === "jsonb"), "Four expected columns and critical types");
    for (const table of ["auth.users", "storage.buckets", "storage.objects"]) {
      const metadata = (await read(`SELECT c.relkind,has_table_privilege(current_user,c.oid,'SELECT') AS can_read,
        row_security_active(c.oid) AS filtered FROM pg_class c WHERE c.oid=to_regclass('${table}')`)).rows[0];
      requireCheck(`Managed base-table access: ${table}`, metadata?.relkind === "r"
        && metadata.can_read && !metadata.filtered, "No RLS-filtered emptiness checks");
      const count = (await read(`SELECT count(*)::text AS count FROM ${table}`)).rows[0].count;
      requireCheck(`Empty initial state: ${table}`, count === "0", { count });
    }
    const privileges = (await read(`SELECT has_database_privilege(current_user,current_database(),'CREATE') AS database_create,
      has_schema_privilege(current_user,'public','CREATE') AS public_create,
      has_schema_privilege(current_user,'public','USAGE') AS public_usage,
      has_schema_privilege(current_user,'auth','USAGE') AS auth_usage,
      has_table_privilege(current_user,'auth.users','TRIGGER') AS auth_trigger,
      has_table_privilege(current_user,'auth.users','REFERENCES') AS auth_references`)).rows[0];
    requireCheck("Required migration privileges", privileges && Object.values(privileges).every(value => value === true), privileges);
    const ownership = (await read(`SELECT 'database' AS kind,datname AS name,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()
      UNION ALL SELECT 'schema',nspname,pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname IN ('public','auth','storage','extensions')`)).rows;
    report("Database and managed schema ownership inspected", "PASS", ownership);
    const grants = (await read(`SELECT pg_get_userbyid(d.defaclrole) AS owner,n.nspname AS schema,
      d.defaclobjtype AS object_type,d.defaclacl::text AS grants FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
      WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR n.nspname IN ('public','auth','storage','extensions')`)).rows;
    report("Managed/default grant catalog inspected", "PASS", grants);
    const roleGrants = (await read(`SELECT has_schema_privilege(rolname,'auth','USAGE') AS usage,
      has_function_privilege(rolname,'auth.uid()','EXECUTE') AS executable FROM pg_roles
      WHERE rolname IN ('anon','authenticated','service_role')`)).rows;
    requireCheck("Client-role Auth helper grants", roleGrants.length === 3
      && roleGrants.every(row => row.usage && row.executable), "All three roles required");
    const extensions = (await read(`SELECT a.installed_version,v.trusted FROM pg_available_extensions a
      LEFT JOIN pg_available_extension_versions v ON v.name=a.name AND v.version=a.default_version
      WHERE a.name='pgcrypto'`)).rows;
    requireCheck("pgcrypto availability", extensions.length === 1
      && Boolean(extensions[0].installed_version || extensions[0].trusted), "Installed or trusted available extension");
    await read("ROLLBACK");
    rolledBack = true;
    report("Read-only transaction cleanup", "PASS", "Rolled back; no DDL, DML or migration execution");
    report("Managed-Supabase runtime DDL/Auth behavior", "NOT VERIFIED", "Catalog prerequisites only; migrations still need separate approval");
  } finally {
    if (connected && !rolledBack) {
      await client.query("ROLLBACK").then(() => report("Failure rollback", "PASS", "Transaction discarded"))
        .catch(() => report("Failure rollback", "NOT VERIFIED", "Connection will be closed; no retry"));
    }
    await client.end();
  }
}

async function main() {
  const target = approvePreflightTarget(process.argv.slice(2), process.env);
  if (target.checkOnly) {
    output("Offline target, CA and boundary configuration", "PASS", "No connection attempted");
    return;
  }
  await runReadOnlyPreflight({ target });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never print URLs, credential values, raw provider errors or stack traces.
    output("Preflight stopped", "FAIL", error instanceof ConnectionSafetyRefusal
      ? error.message : "DATABASE_OR_INPUT_ERROR");
    process.exitCode = 1;
  });
}
