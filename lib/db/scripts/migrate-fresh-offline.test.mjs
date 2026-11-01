import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import pg from "pg";
import {
  approveTarget, loadMigrations, migrationDirectory, protectedProject, runFresh,
} from "./migrate-fresh.mjs";

// No real pg client, database process, socket or migration execution is used.
const ref = "abcdefghijklmnopqrst";
const args = ["--apply", "--project-ref", ref, "--approve-project-ref", ref,
  "--acknowledge-pooler-tls-boundary"];
const env = {
  FRESH_DB_URL: `postgresql://postgres.${ref}:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  FRESH_SUPABASE_URL: `https://${ref}.supabase.co`,
};
const schemas = ["auth", "extensions", "graphql", "graphql_public", "pgbouncer",
  "public", "realtime", "storage", "vault"];
const sql = "SELECT 1"; // Synthetic token consumed only by the fake client.
const migration = {
  idx: 0, tag: "0000_synthetic", when: 1, sql,
  hash: createHash("sha256").update(sql).digest("hex"),
};
const manifest = [{ idx: 0, tag: migration.tag, when: 1, hash: migration.hash }];

async function withFakeClient(options, run) {
  const original = pg.Client;
  const queries = [];
  let connections = 0;
  let ends = 0;
  class FakeClient {
    constructor(config) {
      assert.equal(config.ssl.rejectUnauthorized, true);
      assert.equal(typeof config.ssl.checkServerIdentity, "function");
      assert.equal(config.connectionTimeoutMillis, 5000);
      assert.equal(config.query_timeout, 30000);
      this.connectionParameters = { ssl: config.ssl };
      this.connection = { stream: {
        encrypted: true, authorized: !options.badTls,
        getPeerCertificate: () => ({ subjectaltname: `DNS:${config.host}` }),
      } };
    }
    async connect() { connections++; }
    async end() { ends++; }
    async query(statement) {
      queries.push(statement);
      const rows = (...values) => ({ rows: values });
      if (statement === sql) {
        if (options.failSynthetic) throw new Error("SYNTHETIC_FAILURE");
        return rows();
      }
      if (/^(SET |BEGIN READ WRITE|ROLLBACK|COMMIT)/.test(statement)) return rows();
      if (statement.includes("AS default_read_only")) return rows({
        read_only: "off", default_read_only: "off", statement_timeout: "30s",
        lock_timeout: "3s", idle_timeout: "20s",
      });
      if (statement.includes("server_version_num")) return rows({
        database: "postgres", username: "postgres", version: 170000, tls: true,
      });
      if (statement.includes("FROM pg_roles")) return rows({ count: 4 });
      if (statement.includes("AS users")) return rows({ users: true, uid: true });
      if (statement.includes("MANAGED_STORAGE_BASELINE")) assert.fail("Unexpected SQL");
      if (statement.includes("storage.buckets")) return rows({ present: true });
      if (statement.includes("pg_try_advisory_lock")) return rows({ acquired: !options.busy });
      if (statement.includes("pg_advisory_unlock")) return rows({ released: true });
      if (statement.startsWith("SELECT nspname FROM pg_namespace")) {
        // Evaluate the actual runner allowlist, not a copy of its expected values.
        const match = statement.match(/nspname NOT IN \(([\s\S]*?)\)/);
        assert.ok(match);
        const allowed = [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
        return { rows: (options.schemas ?? schemas)
          .filter(name => !allowed.includes(name)).map(nspname => ({ nspname })) };
      }
      if (statement.includes("SELECT n.nspname AS schema")) return rows(
        { schema: "auth", name: "users" });
      if (statement.startsWith("SELECT EXISTS(SELECT 1 FROM")) return rows({
        populated: Boolean(options.populated),
      });
      if (statement.includes("AS marker")) return rows({ marker: true, ledger: true });
      if (statement.includes("c.relname NOT IN")) return rows();
      if (statement === "SELECT * FROM drizzle.__fresh_bootstrap") return rows({
        singleton: true, project_ref: options.wrongMarker ? "wrong" : ref, manifest,
      });
      if (statement.startsWith("SELECT id,hash,created_at")) return {
        rows: options.pending ? [] : [{
          id: 1, hash: options.badLedger ? "wrong" : migration.hash, created_at: "1",
        }],
      };
      if (statement.includes("AS occupied")) return rows({ occupied: false });
      if (statement.startsWith("INSERT INTO drizzle.__drizzle_migrations")) return rows();
      assert.fail("Unexpected statement in no-I/O runner fixture");
    }
  }
  pg.Client = FakeClient;
  try {
    return await run({ queries, connections: () => connections, ends: () => ends });
  } finally {
    pg.Client = original;
  }
}

test("verified nine-schema set passes the fresh runner's schema guard", async () => {
  await withFakeClient({}, async f => {
    assert.deepEqual(await runFresh({
      target: approveTarget(args, env), migrations: [migration],
    }), { applied: 0, alreadyApplied: 1, total: 1 });
    assert.equal(f.connections(), 1);
    assert.equal(f.ends(), 1);
    assert.ok(!f.queries.includes(sql));
    assert.ok(f.queries.at(-1).includes("pg_advisory_unlock"));
  });
});

test("custom schemas and pgbouncer lookalikes still fail before history or migration work", async t => {
  for (const unknown of ["custom_app", "unknown_schema", "pgbouncer_custom", "PGBOUNCER"]) {
    await t.test(unknown, async () => withFakeClient({ schemas: [...schemas, unknown] }, async f => {
      await assert.rejects(runFresh({
        target: approveTarget(args, env), migrations: [migration],
      }), /UNKNOWN_APPLICATION_SCHEMA/);
      assert.ok(!f.queries.some(query => query.includes("__fresh_bootstrap")));
      assert.ok(!f.queries.includes(sql));
      assert.equal(f.ends(), 1);
    }));
  }
});

test("protected original target and protected connection are refused without constructing clients", async () => {
  await withFakeClient({}, async f => {
    assert.throws(() => approveTarget([
      "--apply", "--project-ref", protectedProject, "--approve-project-ref", protectedProject,
    ], env), /PROTECTED_PROJECT/);
    assert.throws(() => approveTarget(args, {
      ...env, FRESH_DB_URL: `postgresql://postgres:synthetic@db.${protectedProject}.supabase.co/postgres`,
    }), /PROTECTED_PROJECT/);
    const target = approveTarget(args, env);
    await assert.rejects(runFresh({ target: { ...target }, migrations: [migration] }), /TARGET_NOT_APPROVED/);
    await assert.rejects(runFresh({
      target, migrations: [{ ...migration, sql: "SELECT 2" }],
    }), /MIGRATION_HASH_MISMATCH/);
    assert.equal(f.connections(), 0);
  });
});

for (const [label, options, refusal] of [
  ["TLS verification", { badTls: true }, /CLIENT_TLS_NOT_VERIFIED/],
  ["advisory lock", { busy: true }, /MIGRATION_RUNNER_BUSY/],
  ["empty database", { populated: true }, /NONEMPTY_TARGET_OR_OTHER_MIGRATION_HISTORY/],
  ["manifest target", { wrongMarker: true }, /BOOTSTRAP_MANIFEST_OR_TARGET_CHANGED/],
  ["ledger checksum", { badLedger: true }, /UNKNOWN_CHANGED_OR_NONPREFIX_HISTORY/],
]) {
  test(`${label} safeguard still fails closed with pgbouncer present`, async () => {
    await withFakeClient(options, async f => {
      await assert.rejects(runFresh({
        target: approveTarget(args, env), migrations: [migration],
      }), refusal);
      assert.ok(!f.queries.includes(sql));
      assert.equal(f.connections(), 1);
      assert.equal(f.ends(), 1);
      if (options.badTls) assert.equal(f.queries.length, 0);
    });
  });
}

for (const failSynthetic of [false, true]) {
  test(`fake transaction ${failSynthetic ? "rolls back on failure" : "commits on success"} with existing bounds`, async () => {
    await withFakeClient({ pending: true, failSynthetic }, async f => {
      const execute = () => runFresh({ target: approveTarget(args, env), migrations: [migration] });
      if (failSynthetic) await assert.rejects(execute(), /SYNTHETIC_FAILURE/);
      else assert.deepEqual(await execute(), { applied: 1, alreadyApplied: 0, total: 1 });
      assert.ok(f.queries.includes("SET SESSION default_transaction_read_only = off"));
      assert.ok(f.queries.includes("BEGIN READ WRITE"));
      for (const scope of ["SESSION", "LOCAL"]) {
        assert.ok(f.queries.includes(`SET ${scope} statement_timeout = '30s'`));
        assert.ok(f.queries.includes(`SET ${scope} lock_timeout = '3s'`));
        assert.ok(f.queries.includes(`SET ${scope} idle_in_transaction_session_timeout = '20s'`));
      }
      assert.ok(f.queries.includes(failSynthetic ? "ROLLBACK" : "COMMIT"));
      assert.equal(f.queries.includes(failSynthetic ? "COMMIT" : "ROLLBACK"), false);
      assert.equal(f.queries.some(query => query.startsWith("INSERT INTO drizzle.__drizzle_migrations")),
        !failSynthetic);
      assert.ok(f.queries.at(-1).includes("pg_advisory_unlock"));
      assert.equal(f.ends(), 1);
    });
  });
}

test("real journal inventory, original ordering and SQL checksums remain valid without execution", async () => {
  const migrations = await loadMigrations();
  const journal = JSON.parse(await readFile(`${migrationDirectory}/meta/_journal.json`, "utf8"));
  assert.equal(migrations.length, 26);
  assert.deepEqual(migrations.map(entry => entry.tag), journal.entries.map(entry => entry.tag));
  assert.equal(createHash("sha256").update(JSON.stringify(journal.entries.slice(0, 17))).digest("hex"),
    "d864ab6ff904105a5ebda6f78467db2149b63639522291006e323677a7b5cbb9");
  assert.deepEqual(migrations.slice(17).map(entry => entry.tag.slice(0, 4)),
    ["0016", "0017", "0018", "0019", "0020", "0021", "0022", "0024", "0025"]);
  for (const entry of migrations) {
    assert.equal(entry.hash, createHash("sha256").update(entry.sql).digest("hex"));
  }
  const directory = await mkdtemp(`${tmpdir()}/alb-journal-offline-`);
  try {
    await cp(migrationDirectory, directory, { recursive: true });
    const changed = structuredClone(journal);
    changed.entries.push({ ...changed.entries[0], idx: 26 });
    await writeFile(`${directory}/meta/_journal.json`, JSON.stringify(changed));
    await assert.rejects(loadMigrations(directory), /MIGRATION_INVENTORY_MISMATCH/);
    const reordered = structuredClone(journal);
    [reordered.entries[0], reordered.entries[1]] = [reordered.entries[1], reordered.entries[0]];
    await writeFile(`${directory}/meta/_journal.json`, JSON.stringify(reordered));
    await assert.rejects(loadMigrations(directory), /INVALID_JOURNAL_ENTRY/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
