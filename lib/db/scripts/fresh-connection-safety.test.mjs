import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { X509Certificate } from "node:crypto";
import tls from "node:tls";
import {
  verifiedTlsOptions, assertVerifiedClientTls, inspectBackendTls,
  configureBoundedSession, beginBoundedTransaction,
} from "./fresh-connection-safety.mjs";
import { approveTarget, protectedProject } from "./migrate-fresh.mjs";
import { approvePreflightTarget, runReadOnlyPreflight } from "./preflight-fresh.mjs";

const exec = promisify(execFile);
const toolEnv = Object.fromEntries(["PATH", "HOME", "USER", "LANG", "TMPDIR"]
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
const ref = "abcdefghijklmnopqrst";
const directEnv = {
  FRESH_DB_URL: `postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres`,
  FRESH_SUPABASE_URL: `https://${ref}.supabase.co`,
};
const poolerEnv = { ...directEnv,
  FRESH_DB_URL: `postgresql://postgres.${ref}:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
};
const preflightArgs = ["--read-only", "--project-ref", ref, "--approve-project-ref", ref];
let directory, pem, fingerprint, server, port;
const sockets = new Set();

before(async () => {
  directory = await mkdtemp(`${tmpdir()}/alb-connection-safety-`);
  await exec("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", `${directory}/key.pem`, "-out", `${directory}/ca.pem`, "-days", "1",
    "-subj", "/CN=verified.test", "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "subjectAltName=DNS:verified.test"], { env: toolEnv });
  pem = await readFile(`${directory}/ca.pem`, "utf8");
  fingerprint = new X509Certificate(pem).fingerprint256;
  server = tls.createServer({ key: await readFile(`${directory}/key.pem`), cert: pem });
  server.on("tlsClientError", () => {});
  server.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = server.address().port;
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  if (server) await new Promise(resolve => server.close(resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});

function tlsConnection(ssl) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ ...ssl, host: "127.0.0.1", port });
    socket.setTimeout(2000, () => socket.destroy(new Error("LOOPBACK_TLS_TIMEOUT")));
    socket.once("error", reject);
    socket.once("secureConnect", () => resolve(socket));
  });
}

test("public CA file requires its pinned fingerprint; unsafe input never changes TLS verification", async () => {
  const env = { FRESH_DB_CA_CERT_PATH: `${directory}/ca.pem`, FRESH_DB_CA_SHA256: fingerprint };
  const ssl = verifiedTlsOptions("verified.test", env);
  assert.equal(ssl.ca, pem);
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.checkServerIdentity, tls.checkServerIdentity);
  assert.equal(ssl.servername, "verified.test");
  assert.ok(Object.isFrozen(ssl));
  assert.throws(() => verifiedTlsOptions("verified.test", { FRESH_DB_CA_CERT_PATH: env.FRESH_DB_CA_CERT_PATH }),
    /CA_PATH_AND_SHA256_REQUIRED/);
  assert.throws(() => verifiedTlsOptions("verified.test", { ...env, FRESH_DB_CA_SHA256: "00".repeat(32) }),
    /CA_FINGERPRINT_MISMATCH/);
  await writeFile(`${directory}/private-input.pem`, "-----BEGIN PRIVATE KEY-----\nsynthetic\n");
  assert.throws(() => verifiedTlsOptions("verified.test", { ...env, FRESH_DB_CA_CERT_PATH: `${directory}/private-input.pem` }),
    /PUBLIC_CA_ONLY/);
  assert.throws(() => verifiedTlsOptions("verified.test", { ...env, FRESH_DB_CA_CERT_PATH: `${directory}/absent.pem` }),
    /CA_FILE_UNREADABLE_OR_INVALID/);
  const systemRoots = verifiedTlsOptions("verified.test", {});
  assert.equal(systemRoots.ca, undefined);
  assert.equal(systemRoots.rejectUnauthorized, true);
});

test("real loopback TLS proves trusted chain and hostname; untrusted roots and wrong hostname fail", async () => {
  const ssl = verifiedTlsOptions("verified.test", {
    FRESH_DB_CA_CERT_PATH: `${directory}/ca.pem`, FRESH_DB_CA_SHA256: fingerprint,
  });
  const socket = await tlsConnection(ssl);
  try {
    assertVerifiedClientTls({ connectionParameters: { ssl }, connection: { stream: socket } }, "verified.test");
    assert.throws(() => assertVerifiedClientTls({
      connectionParameters: { ssl }, connection: { stream: socket },
    }, "wrong.test"), /CLIENT_TLS_HOSTNAME_NOT_VERIFIED/);
    assert.throws(() => assertVerifiedClientTls({
      connectionParameters: { ssl: { ...ssl, rejectUnauthorized: false } }, connection: { stream: socket },
    }, "verified.test"), /CLIENT_TLS_CONFIGURATION_UNSAFE/);
  } finally {
    socket.destroy();
  }
  await assert.rejects(tlsConnection(verifiedTlsOptions("verified.test", {})));
  await assert.rejects(tlsConnection({ ...ssl, servername: "wrong.test" }), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
});

test("unencrypted, unauthorized or uninspectable client sockets cannot pass", () => {
  const ssl = verifiedTlsOptions("verified.test", {});
  for (const stream of [undefined, { encrypted: false, authorized: true }, { encrypted: true, authorized: false }]) {
    assert.throws(() => assertVerifiedClientTls({ connectionParameters: { ssl }, connection: { stream } },
      "verified.test"), /CLIENT_TLS_NOT_VERIFIED/);
  }
  assert.throws(() => assertVerifiedClientTls({
    connectionParameters: { ssl },
    connection: { stream: { encrypted: true, authorized: true, getPeerCertificate() { return {}; } } },
  }, "verified.test"), /CLIENT_TLS_HOSTNAME_NOT_VERIFIED/);
});

test("pooler boundary is explicit and never misreports upstream encryption; direct TLS remains mandatory", () => {
  assert.throws(() => inspectBackendTls("session-pooler", false, false), /POOLER_TLS_BOUNDARY_ACK_REQUIRED/);
  assert.deepEqual(inspectBackendTls("session-pooler", false, true),
    { mode: "session-pooler", backendTls: false, upstreamEncryptionVerified: false });
  assert.throws(() => inspectBackendTls("direct", false, true), /DIRECT_DATABASE_TLS_REQUIRED/);
  assert.throws(() => inspectBackendTls("session-pooler", null, true), /BACKEND_TLS_NOT_INSPECTABLE/);
  assert.deepEqual(inspectBackendTls("direct", true, false),
    { mode: "direct", backendTls: true, upstreamEncryptionVerified: true });
});

test("both entry points reject pooler use without acknowledgement before constructing a client", () => {
  assert.throws(() => approvePreflightTarget(preflightArgs, poolerEnv), /POOLER_TLS_BOUNDARY_ACK_REQUIRED/);
  const args = [...preflightArgs, "--acknowledge-pooler-tls-boundary"];
  const target = approvePreflightTarget(args, poolerEnv);
  assert.equal(target.connectionMode, "session-pooler");
  assert.equal(target.config.ssl.rejectUnauthorized, true);
  assert.ok(Object.isFrozen(target));
  assert.ok(Object.isFrozen(target.config));
  const applyArgs = ["--apply", "--project-ref", ref, "--approve-project-ref", ref];
  assert.throws(() => approveTarget(applyArgs, poolerEnv), /POOLER_TLS_BOUNDARY_ACK_REQUIRED/);
  assert.equal(approveTarget([...applyArgs, "--acknowledge-pooler-tls-boundary"], poolerEnv).connectionMode, "session-pooler");
});

test("read-only entry point rejects protected/mismatched/ambiguous targets, write flags and fallbacks", () => {
  for (const args of [
    ["--read-only", "--project-ref", protectedProject, "--approve-project-ref", protectedProject],
    [...preflightArgs, "--apply"], [...preflightArgs, "--read-only"],
    preflightArgs.filter(flag => flag !== "--read-only"), [...preflightArgs, "--check"],
    ["--read-only", "--project-ref", ref, "--approve-project-ref", "different"],
  ]) assert.throws(() => approvePreflightTarget(args, directEnv));
  for (const env of [
    {}, { SUPABASE_DB_URL: directEnv.FRESH_DB_URL, SUPABASE_URL: directEnv.FRESH_SUPABASE_URL },
    { ...directEnv, FRESH_SUPABASE_URL: `https://${protectedProject}.supabase.co` },
    { ...directEnv, FRESH_DB_URL: directEnv.FRESH_DB_URL + "?sslmode=disable" },
    { ...poolerEnv, FRESH_DB_URL: poolerEnv.FRESH_DB_URL.replace("5432", "6543") },
    { ...directEnv, FRESH_DB_URL: directEnv.FRESH_DB_URL.replace(`db.${ref}.supabase.co`, "localhost") },
    { ...directEnv, FRESH_DB_URL: directEnv.FRESH_DB_URL.replace("/postgres", "/different") },
  ]) assert.throws(() => approvePreflightTarget(preflightArgs, env));
});

test("offline CLI check has no connection; invalid inputs never disclose values", async () => {
  const script = new URL("./preflight-fresh.mjs", import.meta.url).pathname;
  const args = preflightArgs.map(flag => flag === "--read-only" ? "--check" : flag);
  const checked = await exec(process.execPath, [script, ...args], { env: { ...toolEnv, ...directEnv } });
  assert.match(checked.stdout, /No connection attempted/);
  assert.doesNotMatch(checked.stdout + checked.stderr, /synthetic|postgresql:\/\//);
  const rejected = await exec(process.execPath, [script, "--read-only",
    "--project-ref", protectedProject, "--approve-project-ref", protectedProject],
  { env: { ...toolEnv, FRESH_DB_URL: "SYNTHETIC_SECRET_NEVER_PRINT" } }).catch(error => error);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stdout, /PROTECTED_PROJECT/);
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /SYNTHETIC_SECRET_NEVER_PRINT/);
});

test("preflight cannot import migrations and refuses cloned targets and check-only targets", async () => {
  for (const name of ["preflight-fresh.mjs", "fresh-connection-safety.mjs"]) {
    const source = await readFile(new URL(`./${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*migrate-fresh|import\s*\(|\brunFresh\s*\(|\bloadMigrations\s*\(/);
    assert.doesNotMatch(source, /(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:TABLE|SCHEMA|ROLE|INTO|FROM)/);
  }
  const target = approvePreflightTarget(preflightArgs, directEnv);
  class MustNotConstruct { constructor() { assert.fail("Client construction is forbidden"); } }
  await assert.rejects(runReadOnlyPreflight({ target: { ...target }, Client: MustNotConstruct }), /NOT_APPROVED/);
  const checkOnly = approvePreflightTarget(preflightArgs.map(flag => flag === "--read-only" ? "--check" : flag), directEnv);
  await assert.rejects(runReadOnlyPreflight({ target: checkOnly, Client: MustNotConstruct }), /NOT_APPROVED/);
});

test("preflight attempts one connection only; failed client TLS stops before any SQL", async () => {
  let attempts = 0, queries = 0, ended = 0;
  class FailedConnection {
    on() {}
    async connect() { attempts++; throw new Error("SYNTHETIC_PROVIDER_FAILURE"); }
    async query() { queries++; }
    async end() { ended++; }
  }
  const target = approvePreflightTarget(preflightArgs, directEnv);
  await assert.rejects(runReadOnlyPreflight({ target, Client: FailedConnection, report() {} }));
  assert.equal(attempts, 1);
  assert.equal(queries, 0);
  assert.equal(ended, 1);
  class UnsafeTls extends FailedConnection {
    async connect() { attempts++; }
    async query(sql) { assert.equal(sql, "ROLLBACK"); }
  }
  await assert.rejects(runReadOnlyPreflight({ target, Client: UnsafeTls, report() {} }), /CLIENT_TLS_CONFIGURATION_UNSAFE/);
  assert.equal(attempts, 2, "One attempt in each explicitly separate test invocation");
});

test("settings that fail to take effect stop work; transaction-setting failure rolls back", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      return { rows: [{ default_read_only: "off", read_only: "off",
        statement_timeout: "2min", lock_timeout: "0", idle_timeout: "0" }] };
    },
  };
  await assert.rejects(configureBoundedSession(client, true), /SESSION_LIMITS_NOT_APPLIED/);
  assert.ok(queries.some(sql => sql === "SET SESSION default_transaction_read_only = on"));
  await assert.rejects(beginBoundedTransaction(client, true), /SESSION_LIMITS_NOT_APPLIED/);
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(queries.includes("BEGIN READ ONLY"));
  assert.ok(queries.includes("SET LOCAL statement_timeout = '15s'"));
  assert.ok(queries.every(sql => /^(SET (SESSION|LOCAL)|SELECT|BEGIN READ ONLY|ROLLBACK)/.test(sql)));
});

function catalogDouble({ insufficientPrivilege = false } = {}) {
  const queries = [];
  const reports = [];
  let ended = false;
  class CatalogClient {
    constructor(config) {
      this.connectionParameters = { ssl: config.ssl };
      this.connection = { stream: {
        encrypted: true, authorized: true,
        getPeerCertificate: () => ({ subjectaltname: `DNS:${config.host}` }),
      } };
    }
    on() {}
    async connect() {}
    async end() { ended = true; }
    async query(sql) {
      queries.push(sql);
      const result = rows => ({ rows });
      if (/^(SET (SESSION|LOCAL)|BEGIN READ ONLY|ROLLBACK)/.test(sql)) return result([]);
      assert.match(sql, /^SELECT\s/);
      if (sql.includes("AS default_read_only")) return result([{ read_only: "on", default_read_only: "on",
        statement_timeout: "15s", lock_timeout: "3s", idle_timeout: "20s" }]);
      if (sql.includes("current_database() AS database")) return result([{
        database: "postgres", role: "postgres", session_role: "postgres", version: 170011, backend_tls: false,
      }]);
      if (sql.includes("SELECT nspname AS name")) return result([{ name: "public" }, { name: "auth" }, { name: "storage" }]);
      if (sql.includes("n.nspname='public'") || sql.includes("n.nspname='drizzle'")
        || sql.includes("n.nspname='supabase_migrations'") || sql.includes("FROM pg_trigger")) return result([]);
      if (sql.startsWith("SELECT rolname FROM pg_roles")) return result(["postgres", "anon", "authenticated", "service_role"].map(rolname => ({ rolname })));
      if (sql.includes("p.prorettype='uuid'")) return result([{ executable: true }]);
      if (sql.includes("FROM pg_attribute")) return result([
        { name: "id", type: "uuid" }, { name: "email", type: "text" },
        { name: "raw_user_meta_data", type: "jsonb" }, { name: "created_at", type: "timestamptz" },
      ]);
      if (sql.includes("row_security_active")) return result([{ relkind: "r", can_read: true, filtered: false }]);
      if (sql.startsWith("SELECT count(*)")) return result([{ count: "0" }]);
      if (sql.includes("AS database_create")) return result([{
        database_create: true, public_create: true, public_usage: true, auth_usage: true,
        auth_trigger: !insufficientPrivilege, auth_references: true,
      }]);
      if (sql.includes("'database' AS kind")) return result([{ kind: "database", name: "postgres", owner: "postgres" }]);
      if (sql.includes("FROM pg_default_acl")) return result([]);
      if (sql.includes("AS usage")) return result(Array.from({ length: 3 }, () => ({ usage: true, executable: true })));
      if (sql.includes("FROM pg_available_extensions")) return result([{ installed_version: "1.3", trusted: true }]);
      assert.fail("Unexpected catalog query in offline double");
    }
  }
  return { Client: CatalogClient, queries, reports, report: (...args) => reports.push(args), ended: () => ended };
}

test("full preflight control flow remains read-only and reports the pooler's upstream limitation", async () => {
  const target = approvePreflightTarget([...preflightArgs, "--acknowledge-pooler-tls-boundary"], poolerEnv);
  const fixture = catalogDouble();
  await runReadOnlyPreflight({ target, Client: fixture.Client, report: fixture.report });
  assert.ok(fixture.ended());
  assert.equal(fixture.queries.at(-1), "ROLLBACK");
  assert.ok(fixture.reports.some(([check, status]) => check === "Read-only transaction cleanup" && status === "PASS"));
  assert.ok(fixture.reports.some(([check, status]) => check === "Pooler-to-database encryption" && status === "NOT VERIFIED"));
  assert.ok(fixture.queries.every(sql => /^(SELECT\s|SET (SESSION|LOCAL) |BEGIN READ ONLY$|ROLLBACK$)/.test(sql)));
});

test("insufficient permissions stop full preflight, roll back and close without continuing", async () => {
  const target = approvePreflightTarget([...preflightArgs, "--acknowledge-pooler-tls-boundary"], poolerEnv);
  const fixture = catalogDouble({ insufficientPrivilege: true });
  await assert.rejects(runReadOnlyPreflight({ target, Client: fixture.Client, report: fixture.report }), /PREFLIGHT_CHECK_FAILED/);
  assert.ok(fixture.ended());
  assert.equal(fixture.queries.at(-1), "ROLLBACK");
  assert.ok(fixture.reports.some(([check, status]) => check === "Required migration privileges" && status === "FAIL"));
  assert.ok(!fixture.queries.some(sql => sql.includes("FROM pg_available_extensions")));
});
