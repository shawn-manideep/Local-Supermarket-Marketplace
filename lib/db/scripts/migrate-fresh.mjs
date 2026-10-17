import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

export const migrationDirectory = fileURLToPath(new URL("../../../database/migrations/", import.meta.url));
export const protectedProject = "gkwcolipeavxnuzqlamb";
export const lockKeys = [104289, 741001];
const approvedTargets = new WeakSet();
class BootstrapRefusal extends Error {}
const identifier = value => `"${value.replaceAll('"', '""')}"`;
const requireThat = (condition, code) => { if (!condition) throw new BootstrapRefusal(code); };
const digest = value => createHash("sha256").update(value).digest("hex");

export async function loadMigrations(directory = migrationDirectory) {
  const journal = JSON.parse(await readFile(`${directory}/meta/_journal.json`, "utf8"));
  requireThat(journal.version === "7" && journal.dialect === "postgresql" &&
    Array.isArray(journal.entries) && journal.entries.length > 0, "INVALID_JOURNAL");
  const files = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
  const registered = journal.entries.map(entry => `${entry.tag}.sql`).sort();
  requireThat(JSON.stringify(files) === JSON.stringify(registered), "MIGRATION_INVENTORY_MISMATCH");
  let lastWhen = -1;
  return Promise.all(journal.entries.map(async (entry, index) => {
    requireThat(entry.idx === index && entry.version === "7" && entry.breakpoints === true &&
      /^\d{4}_[a-z0-9_]+$/.test(entry.tag) && Number.isSafeInteger(entry.when) &&
      entry.when > lastWhen, "INVALID_JOURNAL_ENTRY");
    lastWhen = entry.when;
    const path = `${directory}/${entry.tag}.sql`;
    requireThat((await lstat(path)).isFile(), "MIGRATION_NOT_REGULAR_FILE");
    const sql = await readFile(path, "utf8");
    requireThat(sql.trim().length > 0, "EMPTY_MIGRATION");
    return { ...entry, hash: digest(sql), sql };
  }));
}

// No default connection strings, dotenv loading, or use of SUPABASE_DB_URL/PG*.
export function approveTarget(args, env) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    requireThat(["--apply", "--project-ref", "--approve-project-ref", "--local-test-token"].includes(flag) &&
      !(flag in options), "INVALID_ARGUMENTS");
    if (flag === "--apply") options[flag] = true;
    else {
      requireThat(args[index + 1] && !args[index + 1].startsWith("--"), "INVALID_ARGUMENTS");
      options[flag] = args[++index];
    }
  }
  const ref = options["--project-ref"];
  requireThat(ref !== protectedProject && options["--approve-project-ref"] !== protectedProject,
    "PROTECTED_PROJECT");
  requireThat(options["--apply"] && ref && ref === options["--approve-project-ref"], "EXACT_APPROVAL_REQUIRED");
  requireThat(typeof env.FRESH_DB_URL === "string" && env.FRESH_DB_URL.length > 0, "EXPLICIT_CONNECTION_REQUIRED");
  let url;
  try { url = new URL(env.FRESH_DB_URL); } catch { throw new BootstrapRefusal("INVALID_CONNECTION"); }
  requireThat(["postgres:", "postgresql:"].includes(url.protocol) && !url.search && !url.hash,
    "UNSUPPORTED_CONNECTION_OPTIONS");
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1));
  const password = decodeURIComponent(url.password);
  const port = Number(url.port || 5432);
  const token = options["--local-test-token"];
  let local = false;
  if (token) {
    local = true;
    requireThat(/^[a-f0-9]{32}$/.test(token) && ref === `local-${token}` &&
      url.hostname === "127.0.0.1" && port > 1024 && port <= 65535 && port !== 5432 &&
      user === "postgres" && !password && database === `fresh_test_${token}` &&
      !env.FRESH_SUPABASE_URL, "INVALID_LOCAL_TEST_TARGET");
  } else {
    requireThat(/^[a-z0-9]{20}$/.test(ref), "INVALID_PROJECT_REFERENCE");
    requireThat(env.FRESH_SUPABASE_URL === `https://${ref}.supabase.co`, "API_PROJECT_MISMATCH");
    const direct = url.hostname === `db.${ref}.supabase.co` && user === "postgres";
    const sessionPooler = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
      user === `postgres.${ref}`;
    requireThat(port === 5432 && database === "postgres" && password && (direct || sessionPooler),
      "CONNECTION_PROJECT_MISMATCH");
  }
  const target = {
    ref, local, token, database,
    config: {
      host: url.hostname, port, user, password: password || "disposable-test-only",
      database, ssl: local ? false : Object.freeze({ rejectUnauthorized: true }),
      application_name: "alb-fresh-bootstrap", connectionTimeoutMillis: 5000,
      query_timeout: 30000, options: "-c statement_timeout=30000",
    },
  };
  Object.freeze(target.config);
  Object.freeze(target);
  approvedTargets.add(target);
  return target;
}

async function verifyServer(client, target) {
  const { rows: [server] } = await client.query(`SELECT current_database() AS database,
    current_user AS username, current_setting('server_version_num')::int AS version,
    inet_server_addr()::text AS address,
    current_setting('alb.fresh_test_cluster_id', true) AS test_token,
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`);
  requireThat(server.database === target.database && server.username === "postgres" &&
    server.version >= 170000, "SERVER_IDENTITY_OR_VERSION_MISMATCH");
  if (target.local) {
    requireThat(server.address === "127.0.0.1/32" || server.address === "127.0.0.1",
      "NON_LOOPBACK_TEST_SERVER");
    requireThat(server.test_token === target.token, "LOCAL_CLUSTER_PROOF_MISMATCH");
  } else {
    requireThat(server.tls === true, "TLS_REQUIRED");
  }
  const { rows: [roles] } = await client.query(`SELECT count(*)::int AS count FROM pg_roles
    WHERE rolname IN ('postgres','anon','authenticated','service_role')`);
  requireThat(roles.count === 4, "SUPABASE_ROLES_MISSING");
  const { rows: [auth] } = await client.query(`SELECT
    to_regclass('auth.users') IS NOT NULL AS users,
    to_regprocedure('auth.uid()') IS NOT NULL AS uid`);
  requireThat(auth.users && auth.uid, "SUPABASE_AUTH_MISSING");
  if (!target.local) {
    const { rows: [storage] } = await client.query(`SELECT
      to_regclass('storage.buckets') IS NOT NULL AND
      to_regclass('storage.objects') IS NOT NULL AS present`);
    requireThat(storage.present, "MANAGED_STORAGE_BASELINE_MISSING");
  }
}

async function assertNoData(client) {
  const { rows: unknownSchemas } = await client.query(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND nspname <> 'information_schema'
    AND nspname NOT IN ('public','drizzle','auth','storage','extensions','graphql','graphql_public',
      'realtime','_realtime','supabase_functions','supabase_migrations','vault',
      'pgsodium','pgsodium_masks','cron','net')`);
  requireThat(unknownSchemas.length === 0, "UNKNOWN_APPLICATION_SCHEMA");
  const { rows } = await client.query(`SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname='public' AND c.relkind IN ('r','p','f','m'))
       OR (n.nspname='auth' AND c.relname='users' AND c.relkind='r')
       OR (n.nspname='storage' AND c.relname IN ('objects','buckets') AND c.relkind='r')
       OR (n.nspname='supabase_migrations' AND c.relkind IN ('r','p'))`);
  for (const row of rows) {
    const { rows: [result] } = await client.query(
      `SELECT EXISTS(SELECT 1 FROM ${identifier(row.schema)}.${identifier(row.name)} LIMIT 1) AS populated`);
    requireThat(!result.populated, "NONEMPTY_TARGET_OR_OTHER_MIGRATION_HISTORY");
  }
}

async function assertFreshPublicSchema(client) {
  const { rows: [result] } = await client.query(`SELECT
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public') OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND NOT EXISTS(
        SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass
          AND d.objid=p.oid AND d.deptype='e')) OR
    EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typtype IN ('e','d','c')) OR
    EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='auth.users'::regclass
      AND NOT t.tgisinternal) AS occupied`);
  requireThat(!result.occupied, "APPLICATION_SCHEMA_NOT_EMPTY");
}

async function readHistory(client, target, manifest) {
  const { rows: [exists] } = await client.query(`SELECT
    to_regclass('drizzle.__fresh_bootstrap') IS NOT NULL AS marker,
    to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ledger`);
  const { rows: extras } = await client.query(`SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='drizzle'
    AND c.relkind IN ('r','p','S','v','m','f')
    AND c.relname NOT IN ('__fresh_bootstrap','__drizzle_migrations','__drizzle_migrations_id_seq')`);
  requireThat(extras.length === 0, "UNKNOWN_HISTORY_OBJECTS");
  requireThat(exists.marker === exists.ledger, "UNOWNED_OR_INCONSISTENT_LEDGER");
  if (!exists.marker) {
    await assertFreshPublicSchema(client);
    await client.query("BEGIN");
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle;
        CREATE TABLE drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
        CREATE TABLE drizzle.__fresh_bootstrap (
          singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
          project_ref text NOT NULL, manifest jsonb NOT NULL);
        REVOKE ALL ON SCHEMA drizzle FROM PUBLIC, anon, authenticated;
        REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM PUBLIC, anon, authenticated;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA drizzle FROM PUBLIC, anon, authenticated;`);
      await client.query(`INSERT INTO drizzle.__fresh_bootstrap(project_ref,manifest)
        VALUES($1,$2::jsonb)`, [target.ref, JSON.stringify(manifest)]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return [];
  }
  const { rows: markers } = await client.query("SELECT * FROM drizzle.__fresh_bootstrap");
  // jsonb does not retain object key order; compare semantic fields, not JSON text.
  requireThat(markers.length === 1 && markers[0].singleton === true &&
    markers[0].project_ref === target.ref &&
    Array.isArray(markers[0].manifest) && markers[0].manifest.length === manifest.length &&
    manifest.every((entry, index) => {
      const stored = markers[0].manifest[index];
      return stored && Object.keys(stored).length === Object.keys(entry).length &&
        Object.keys(entry).every(key => stored[key] === entry[key]);
    }), "BOOTSTRAP_MANIFEST_OR_TARGET_CHANGED");
  const { rows } = await client.query("SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id");
  requireThat(rows.length <= manifest.length && rows.every((row, index) =>
    Number.isSafeInteger(row.id) && row.id > 0 && (index === 0 || row.id > rows[index - 1].id) &&
    row.hash === manifest[index].hash && String(row.created_at) === String(manifest[index].when)),
  "UNKNOWN_CHANGED_OR_NONPREFIX_HISTORY");
  if (rows.length === 0) await assertFreshPublicSchema(client);
  return rows;
}

export async function runFresh({ target, migrations, onApplied = () => {} }) {
  requireThat(approvedTargets.has(target), "TARGET_NOT_APPROVED");
  requireThat(Array.isArray(migrations) && migrations.length > 0 &&
    migrations.every(entry => typeof entry.sql === "string" && digest(entry.sql) === entry.hash),
  "MIGRATION_HASH_MISMATCH");
  const manifest = migrations.map(({ idx, tag, when, hash }) => ({ idx, tag, when, hash }));
  const client = new pg.Client(target.config);
  let locked = false;
  let applied = 0;
  try {
    await client.connect();
    await verifyServer(client, target);
    const { rows: [lock] } = await client.query("SELECT pg_try_advisory_lock($1,$2) AS acquired", lockKeys);
    requireThat(lock.acquired, "MIGRATION_RUNNER_BUSY");
    locked = true;
    await client.query("SET search_path TO public, pg_catalog");
    await assertNoData(client);
    const history = await readHistory(client, target, manifest);
    for (const migration of migrations.slice(history.length)) {
      await client.query("BEGIN");
      try {
        // One whole file per transaction: dollar-quoted function bodies are not split.
        await client.query(migration.sql);
        await client.query(`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
          VALUES($1,$2)`, [migration.hash, migration.when]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      applied++;
      await onApplied(migration);
    }
    return { applied, alreadyApplied: history.length, total: manifest.length };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1,$2)", lockKeys).catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const migrations = await loadMigrations();
  if (args.length === 1 && args[0] === "--check") {
    console.log(`Inventory valid: ${migrations.length} registered SQL files. No database connection.`);
    return;
  }
  const target = approveTarget(args, process.env);
  const result = await runFresh({ target, migrations });
  console.log(`Bootstrap complete: ${result.applied} applied, ${result.alreadyApplied} already applied, ${result.total} total.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never print driver messages, URLs, parameters, SQL, stack traces or credentials.
    const safe = error instanceof BootstrapRefusal
      ? error.message : "DATABASE_OR_INPUT_ERROR";
    console.error(`Fresh bootstrap refused/failed: ${safe}`);
    process.exitCode = 1;
  });
}
