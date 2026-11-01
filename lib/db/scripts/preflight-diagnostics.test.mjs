import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConnectionSafetyRefusal } from "./fresh-connection-safety.mjs";
import {
  approvePreflightTarget, preflightErrorCategory, runReadOnlyPreflight,
} from "./preflight-fresh.mjs";

// Synthetic inputs only. These tests never construct a pg client or open sockets.
const ref = "abcdefghijklmnopqrst";
const target = () => approvePreflightTarget([
  "--read-only", "--project-ref", ref, "--approve-project-ref", ref,
  "--acknowledge-pooler-tls-boundary",
], {
  FRESH_SUPABASE_URL: `https://${ref}.supabase.co`,
  FRESH_DB_URL: `postgresql://postgres.${ref}:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
});
const sensitive = "postgresql://user:DO_NOT_PRINT@provider.invalid/db SELECT secret";
const providerError = code => Object.assign(new Error(sensitive), {
  code, detail: sensitive, hint: sensitive, query: sensitive, stack: sensitive,
});

test("CLI target refusal reports TARGET_VALIDATION without leaking inputs", async () => {
  const run = promisify(execFile);
  const result = await run(process.execPath, [
    new URL("./preflight-fresh.mjs", import.meta.url).pathname,
    "--read-only", "--project-ref", ref, "--approve-project-ref", ref,
  ], { env: { FRESH_DB_URL: sensitive, FRESH_SUPABASE_URL: "invalid" } })
    .catch(error => error);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.detail.stage, "TARGET_VALIDATION");
  assert.equal(report.detail.category, "SAFETY_REFUSAL");
  assert.ok(!`${result.stdout}${result.stderr}`.includes(sensitive));
});

function fixture({ failAt, primary = providerError("42501"), endError, rollbackError } = {}) {
  const reports = [];
  const queries = [];
  let attempts = 0;
  let ends = 0;
  class Client {
    constructor(config) {
      if (failAt === "CLIENT_CONSTRUCTION") throw primary;
      this.connectionParameters = { ssl: config.ssl };
      this.connection = { stream: {
        encrypted: true, authorized: failAt !== "CLIENT_TLS_VERIFICATION",
        getPeerCertificate: () => ({ subjectaltname: `DNS:${config.host}` }),
      } };
      assert.equal(config.ssl.rejectUnauthorized, true);
      assert.equal(config.connectionTimeoutMillis, 8000);
      assert.equal(config.query_timeout, 15000);
      assert.match(config.options, /default_transaction_read_only=on/);
    }
    on() {}
    async connect() {
      attempts++;
      if (failAt === "CONNECT") throw primary;
    }
    async end() {
      ends++;
      if (endError) throw endError;
    }
    async query(sql) {
      queries.push(sql);
      if (sql === "ROLLBACK" && rollbackError) throw rollbackError;
      if (failAt === "SESSION_SETUP" && sql.startsWith("SET SESSION")) throw primary;
      if (failAt === "TRANSACTION_SETUP" && sql === "BEGIN READ ONLY") throw primary;
      if (failAt === "READ_ONLY_INSPECTION" && sql.includes("current_database() AS database")) throw primary;
      const result = rows => ({ rows });
      if (/^(SET (SESSION|LOCAL)|BEGIN READ ONLY|ROLLBACK)/.test(sql)) return result([]);
      // Fail closed if the implementation ever submits DDL, DML or unknown SQL.
      assert.match(sql, /^SELECT\s/);
      if (sql.includes("AS default_read_only")) return result([{
        read_only: "on", default_read_only: "on", statement_timeout: "15s",
        lock_timeout: "3s", idle_timeout: "20s",
      }]);
      if (sql.includes("current_database() AS database")) return result([{
        database: "postgres", role: "postgres", session_role: "postgres",
        version: 170011, backend_tls: false,
      }]);
      if (sql.includes("SELECT nspname AS name")) return result([{ name: "public" }]);
      if (sql.includes("n.nspname='public'") || sql.includes("n.nspname='drizzle'")
        || sql.includes("n.nspname='supabase_migrations'") || sql.includes("FROM pg_trigger")) return result([]);
      if (sql.startsWith("SELECT rolname FROM pg_roles")) return result(
        ["postgres", "anon", "authenticated", "service_role"].map(rolname => ({ rolname })));
      if (sql.includes("p.prorettype='uuid'")) return result([{ executable: true }]);
      if (sql.includes("FROM pg_attribute")) return result([
        { name: "id", type: "uuid" }, { name: "email", type: "text" },
        { name: "raw_user_meta_data", type: "jsonb" }, { name: "created_at", type: "timestamptz" },
      ]);
      if (sql.includes("row_security_active")) return result([{ relkind: "r", can_read: true, filtered: false }]);
      if (sql.startsWith("SELECT count(*)")) return result([{ count: "0" }]);
      if (sql.includes("AS database_create")) return result([{
        database_create: true, public_create: true, public_usage: true,
        auth_usage: true, auth_trigger: true, auth_references: true,
      }]);
      if (sql.includes("'database' AS kind")) return result([{ kind: "database", name: "postgres", owner: "postgres" }]);
      if (sql.includes("FROM pg_default_acl")) return result([]);
      if (sql.includes("AS usage")) return result(
        Array.from({ length: 3 }, () => ({ usage: true, executable: true })));
      if (sql.includes("pg_available_extensions")) return result([{ installed_version: "1.3", trusted: true }]);
      assert.fail("Unexpected synthetic query");
    }
  }
  return {
    Client, reports, queries,
    report: (...args) => reports.push(args),
    attempts: () => attempts, ends: () => ends,
  };
}

test("error categories use fixed allowlists and never forward provider fields", () => {
  const cases = {
    ENOTFOUND: "DNS_FAILURE", EAI_AGAIN: "DNS_FAILURE",
    ECONNREFUSED: "CONNECTION_REFUSED", ETIMEDOUT: "CONNECTION_TIMEOUT",
    ERR_SOCKET_CONNECTION_TIMEOUT: "CONNECTION_TIMEOUT",
    ECONNRESET: "CONNECTION_RESET", EPIPE: "CONNECTION_RESET",
    CERT_HAS_EXPIRED: "TLS_CERTIFICATE_FAILURE",
    CERT_NOT_YET_VALID: "TLS_CERTIFICATE_FAILURE",
    DEPTH_ZERO_SELF_SIGNED_CERT: "TLS_CERTIFICATE_FAILURE",
    SELF_SIGNED_CERT_IN_CHAIN: "TLS_CERTIFICATE_FAILURE",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS_CERTIFICATE_FAILURE",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "TLS_CERTIFICATE_FAILURE",
    ERR_TLS_CERT_ALTNAME_INVALID: "TLS_CERTIFICATE_FAILURE",
    "28P01": "AUTHENTICATION_REJECTED", "28000": "AUTHENTICATION_REJECTED",
    "42501": "INSUFFICIENT_PRIVILEGE",
  };
  for (const [code, category] of Object.entries(cases)) {
    assert.equal(preflightErrorCategory(providerError(code)), category);
  }
  for (const code of [sensitive, "__proto__", "constructor", undefined]) {
    assert.equal(preflightErrorCategory(providerError(code)), "UNCLASSIFIED_FAILURE");
  }
  assert.equal(preflightErrorCategory(null), "UNCLASSIFIED_FAILURE");
  assert.equal(preflightErrorCategory(new ConnectionSafetyRefusal(sensitive)), "SAFETY_REFUSAL");
  assert.equal(preflightErrorCategory(new Error("timeout expired")), "CONNECTION_TIMEOUT");
  assert.equal(preflightErrorCategory(new Error("Query read timeout")), "QUERY_TIMEOUT");
});

for (const stage of [
  "CLIENT_CONSTRUCTION", "CONNECT", "CLIENT_TLS_VERIFICATION",
  "SESSION_SETUP", "TRANSACTION_SETUP", "READ_ONLY_INSPECTION",
]) {
  test(`${stage} failure is separately identified and sanitized without retries`, async () => {
    const f = fixture({ failAt: stage });
    await assert.rejects(runReadOnlyPreflight({ target: target(), ...f }));
    assert.deepEqual(f.reports.find(([name]) => name === "Preflight failure"), [
      "Preflight failure", "FAIL", {
        stage, category: stage === "CLIENT_TLS_VERIFICATION" ? "SAFETY_REFUSAL" : "INSUFFICIENT_PRIVILEGE",
      },
    ]);
    assert.equal(f.attempts(), stage === "CLIENT_CONSTRUCTION" ? 0 : 1);
    assert.equal(f.ends(), stage === "CLIENT_CONSTRUCTION" ? 0 : 1);
    if (stage === "CONNECT") assert.deepEqual(f.queries, []);
    if (stage === "CLIENT_TLS_VERIFICATION") assert.deepEqual(f.queries, ["ROLLBACK"]);
    assert.ok(!JSON.stringify(f.reports).includes(sensitive));
  });
}

test("connection failure survives a simultaneous close failure", async () => {
  const primary = providerError("28P01");
  const f = fixture({ failAt: "CONNECT", primary, endError: providerError("ECONNRESET") });
  await assert.rejects(runReadOnlyPreflight({ target: target(), ...f }), error => error === primary);
  assert.equal(f.attempts(), 1);
  assert.equal(f.ends(), 1);
  assert.deepEqual(f.queries, []);
  assert.deepEqual(f.reports.at(-1), [
    "Client cleanup failure", "FAIL", { stage: "CLEANUP", category: "CONNECTION_RESET" },
  ]);
  assert.ok(!JSON.stringify(f.reports).includes(sensitive));
});

test("inspection failure survives both rollback and close failures", async () => {
  const primary = providerError("42501");
  const f = fixture({
    failAt: "READ_ONLY_INSPECTION", primary,
    rollbackError: providerError("ECONNRESET"), endError: providerError(sensitive),
  });
  await assert.rejects(runReadOnlyPreflight({ target: target(), ...f }), error => error === primary);
  assert.equal(f.attempts(), 1);
  assert.equal(f.ends(), 1);
  assert.equal(f.queries.at(-1), "ROLLBACK");
  assert.ok(f.reports.some(([name, status]) => name === "Failure rollback" && status === "NOT VERIFIED"));
  assert.ok(!JSON.stringify(f.reports).includes(sensitive));
});

test("close failure after otherwise successful inspection fails with CLEANUP stage", async () => {
  const endError = providerError("ECONNRESET");
  const f = fixture({ endError });
  await assert.rejects(runReadOnlyPreflight({ target: target(), ...f }), error => error === endError);
  assert.deepEqual(f.reports.at(-1), [
    "Client cleanup failure", "FAIL", { stage: "CLEANUP", category: "CONNECTION_RESET" },
  ]);
  assert.equal(f.attempts(), 1);
  assert.equal(f.ends(), 1);
  assert.equal(f.queries.filter(sql => sql === "ROLLBACK").length, 1);
});

test("successful preflight retains read-only transaction, timeouts and rollback", async () => {
  const f = fixture();
  await runReadOnlyPreflight({ target: target(), ...f });
  assert.equal(f.attempts(), 1);
  assert.equal(f.ends(), 1);
  assert.ok(f.queries.includes("SET SESSION default_transaction_read_only = on"));
  assert.ok(f.queries.includes("BEGIN READ ONLY"));
  for (const scope of ["SESSION", "LOCAL"]) {
    assert.ok(f.queries.includes(`SET ${scope} statement_timeout = '15s'`));
    assert.ok(f.queries.includes(`SET ${scope} lock_timeout = '3s'`));
    assert.ok(f.queries.includes(`SET ${scope} idle_in_transaction_session_timeout = '20s'`));
  }
  assert.equal(f.queries.at(-1), "ROLLBACK");
  assert.ok(f.queries.every(sql => /^(SELECT\s|SET (SESSION|LOCAL) |BEGIN READ ONLY$|ROLLBACK$)/.test(sql)));
  assert.ok(!f.reports.some(([, status]) => status === "FAIL"));
});
