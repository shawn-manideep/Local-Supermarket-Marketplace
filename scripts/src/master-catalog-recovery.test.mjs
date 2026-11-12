import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { SOURCE_PROJECT, DESTINATION_PROJECT, COLUMNS, createPackage, validatePackage, rehearseRecovery } from "./master-catalog-recovery.mjs";

const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { Client } = require("pg");
const bin = "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";
let directory, running = false;
// Deliberately do not inherit managed database connection defaults or credentials.
const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = "2026-10-01T01:02:03.123456Z";
function dataset() {
  return {
    master_categories: Array.from({ length: 63 }, (_, i) => ({
      id: id(i + 1), name: `Category ${i}`, is_active: i % 2 === 0, created_at: date, updated_at: date,
    })),
    master_products: Array.from({ length: 687 }, (_, i) => ({
      id: id(i + 1000), master_category_id: i % 3 === 0 ? null : id(i % 63 + 1),
      name: `తెలుగు ' Product ${i}`, description: i % 2 ? "" : null,
      image: i % 2 ? "https://example.invalid/path?x=%2F" : null, brand: i % 2 ? "" : null,
      attributes: { nested: { b: [true, null, ""] }, a: "value" },
      is_active: i % 2 === 0, created_at: date, updated_at: date,
    })),
  };
}
function pkg(data = dataset()) {
  return createPackage({ sourceProject: SOURCE_PROJECT, destinationProject: DESTINATION_PROJECT, data });
}
async function client() {
  const c = new Client({ host: directory, port: 55439, database: "alb_catalog_rehearsal", user: "alb_rehearsal",
    ssl: false, connectionTimeoutMillis: 3000, query_timeout: 15000, password: "" });
  await c.connect(); return c;
}
let schemaNumber = 0;
async function fixture() {
  const c = await client();
  const schema = `rehearsal_${++schemaNumber}`;
  // Actual relevant DDL from the approved migrations, isolated per scenario.
  const ddl = readFileSync(new URL("../../database/migrations/0009_master_catalog.sql", import.meta.url), "utf8");
  const categories = ddl.slice(ddl.indexOf("CREATE TABLE public.master_categories"), ddl.indexOf("ALTER TABLE public.categories"));
  const triggerDdl = ddl.slice(ddl.indexOf("CREATE TRIGGER master_categories_set_updated_at"),
    ddl.indexOf("CREATE OR REPLACE FUNCTION public.prevent_master_mapping_audit_mutation"));
  await c.query(`CREATE SCHEMA ${schema}`);
  await c.query(categories.replaceAll("public.", `${schema}.`));
  await c.query(`ALTER TABLE ${schema}.master_products ALTER COLUMN master_category_id DROP NOT NULL`);
  await c.query(triggerDdl.replace(/\bON public\./g, `ON ${schema}.`));
  await c.query(`CREATE INDEX ON ${schema}.master_categories(is_active,name); CREATE INDEX ON ${schema}.master_products(master_category_id); CREATE INDEX ON ${schema}.master_products(is_active,name)`);
  // Only the two fixed application table references are translated to fixture schema.
  const query = c.query.bind(c);
  c.query = (text, values) => query(text.replaceAll("public.master_categories", `${schema}.master_categories`)
    .replaceAll("public.master_products", `${schema}.master_products`), values);
  return { c, schema };
}
async function count(schema) {
  const c = await client();
  try { return (await c.query(`SELECT (SELECT count(*)::int FROM ${schema}.master_categories) AS categories,
    (SELECT count(*)::int FROM ${schema}.master_products) AS products`)).rows[0]; }
  finally { await c.end(); }
}
async function run(c, value = pkg()) {
  return rehearseRecovery({ client: c, package: value, destinationProject: DESTINATION_PROJECT });
}
before(async () => {
  directory = mkdtempSync("/tmp/alb-catalog-rehearsal-");
  execFileSync(`${bin}/initdb`, ["-D", `${directory}/data`, "-U", "alb_rehearsal", "-A", "trust", "--no-locale", "--encoding=UTF8"], { env: environment, stdio: "pipe" });
  execFileSync(`${bin}/pg_ctl`, ["-D", `${directory}/data`, "-l", `${directory}/server.log`,
    "-o", `-p 55439 -h '' -k ${directory}`, "-w", "start"], { env: environment, stdio: "pipe" });
  running = true;
  const bootstrap = new Client({ host: directory, port: 55439, user: "alb_rehearsal", database: "postgres", password: "", ssl: false });
  await bootstrap.connect();
  try { await bootstrap.query("CREATE DATABASE alb_catalog_rehearsal"); } finally { await bootstrap.end(); }
  const c = await client();
  try {
    const base = readFileSync(new URL("../../database/migrations/0000_furry_doomsday.sql", import.meta.url), "utf8");
    for (const name of ["set_updated_at", "prevent_catalog_hard_delete"]) {
      const start = base.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
      assert.ok(start >= 0);
      const end = base.indexOf("$$;", start) + 3;
      await c.query(base.slice(start, end));
    }
  } finally { await c.end(); }
});
after(() => {
  if (running) execFileSync(`${bin}/pg_ctl`, ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"], { env: environment, stdio: "pipe" });
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("package integrity, exact counts and field allowlists", () => {
  const value = pkg(); assert.deepEqual(validatePackage(value), value);
  value.data.master_products[0].image = "changed";
  assert.throws(() => validatePackage(value), /PACKAGE_INTEGRITY_FAILURE/);
  const d = dataset(); d.master_categories.pop(); assert.throws(() => pkg(d));
  const extra = dataset(); extra.master_products[0].unexpected = "no"; assert.throws(() => pkg(extra), /INVALID_FIELDS/);
});
test("duplicate UUIDs and invalid category references are rejected", () => {
  const d = dataset(); d.master_products[1].id = d.master_products[0].id;
  assert.throws(() => pkg(d), /DUPLICATE_UUID/);
  const categories = dataset(); categories.master_categories[1].id = categories.master_categories[0].id;
  assert.throws(() => pkg(categories), /DUPLICATE_UUID/);
  const invalid = dataset(); invalid.master_products[0].master_category_id = id(999999);
  assert.throws(() => pkg(invalid), /INVALID_CATEGORY_REFERENCE/);
});
test("fixed source/destination identities cannot be swapped", () => {
  assert.throws(() => createPackage({ sourceProject: DESTINATION_PROJECT, destinationProject: SOURCE_PROJECT, data: dataset() }), /TARGET_REFUSED/);
});
test("invalid dates and potentially lossy JSON numbers fail closed", () => {
  const invalid = dataset(); invalid.master_products[0].created_at = "2026-02-30T01:02:03.123456Z";
  assert.throws(() => pkg(invalid), /INVALID_TIMESTAMP/);
  const numeric = dataset(); numeric.master_products[0].attributes = { precisionRisk: 0.1 };
  assert.throws(() => pkg(numeric), /INVALID_JSON/);
});
test("remote clients are rejected before any query", async () => {
  await assert.rejects(run({ connectionParameters: { host: "remote.invalid" }, query() { assert.fail(); } }), /OFFLINE_CLIENT_REQUIRED/);
});
test("exact PostgreSQL roundtrip preserves NULL, empty text, JSONB, archives, URLs and microseconds", async () => {
  const { c, schema } = await fixture();
  assert.deepEqual(await run(c), { status: "COMMITTED", categories: 63, products: 687 });
  assert.deepEqual(await count(schema), { categories: 63, products: 687 });
  const again = await client();
  const query = again.query.bind(again);
  again.query = (s, v) => query(s.replaceAll("public.master_categories", `${schema}.master_categories`).replaceAll("public.master_products", `${schema}.master_products`), v);
  await assert.rejects(run(again), /RECOVERY_ABORTED/);
  assert.deepEqual(await count(schema), { categories: 63, products: 687 });
});
test("existing destination data refuses the entire transaction", async () => {
  const { c, schema } = await fixture();
  await c.query("INSERT INTO public.master_categories(id,name) VALUES($1,$2)", [id(999), "existing"]);
  await assert.rejects(run(c), /RECOVERY_ABORTED/);
  assert.deepEqual(await count(schema), { categories: 1, products: 0 });
});
test("failed product insertion rolls back already inserted categories and sanitizes errors", async () => {
  const { c, schema } = await fixture(); const query = c.query.bind(c);
  c.query = (s, v) => s.startsWith("INSERT INTO public.master_products") ? Promise.reject(new Error("PRIVATE_ROW_AND_CREDENTIAL")) : query(s, v);
  await assert.rejects(run(c), e => e.message === "RECOVERY_ABORTED" && !e.cause);
  assert.deepEqual(await count(schema), { categories: 0, products: 0 });
});
test("precommit content mismatch rolls back everything", async () => {
  const { c, schema } = await fixture(); const query = c.query.bind(c); let selects = 0;
  c.query = async (s, v) => {
    const result = await query(s, v);
    if (s.startsWith("SELECT ") && s.includes("FROM public.master_products") && ++selects === 2) result.rows[0].brand = "unexpected";
    return result;
  };
  await assert.rejects(run(c), /RECOVERY_ABORTED/);
  assert.deepEqual(await count(schema), { categories: 0, products: 0 });
});
test("concurrent catalog writer times out without modifying its records", async () => {
  const { c, schema } = await fixture(); const other = await client();
  try {
    await other.query("BEGIN");
    await other.query(`LOCK TABLE ${schema}.master_categories IN ROW EXCLUSIVE MODE`);
    await assert.rejects(run(c), /RECOVERY_ABORTED/);
    assert.deepEqual(await count(schema), { categories: 0, products: 0 });
  } finally { await other.query("ROLLBACK"); await other.end(); }
});
test("lost acknowledgement after successful COMMIT is unknown and never replayed", async () => {
  const { c, schema } = await fixture(); const query = c.query.bind(c); let commits = 0;
  c.query = async (s, v) => {
    const result = await query(s, v);
    if (s === "COMMIT") { commits++; throw new Error("provider private error"); }
    return result;
  };
  await assert.rejects(run(c), /UNKNOWN_COMMIT_OUTCOME/);
  assert.equal(commits, 1);
  assert.deepEqual(await count(schema), { categories: 63, products: 687 });
});
test("failed COMMIT before transmission remains unknown; disconnect rolls back", async () => {
  const { c, schema } = await fixture(); const query = c.query.bind(c);
  c.query = (s, v) => s === "COMMIT" ? Promise.reject(new Error("disconnected")) : query(s, v);
  await assert.rejects(run(c), /UNKNOWN_COMMIT_OUTCOME/);
  assert.deepEqual(await count(schema), { categories: 0, products: 0 });
});
test("cleanup failures do not replace the original failure", async () => {
  const { c, schema } = await fixture(); const query = c.query.bind(c), end = c.end.bind(c);
  c.query = (s, v) => s.startsWith("INSERT") ? Promise.reject(new Error("private")) : query(s, v);
  c.end = async () => { await end(); throw new Error("private cleanup"); };
  await assert.rejects(run(c), e => e.message === "RECOVERY_ABORTED");
  assert.deepEqual(await count(schema), { categories: 0, products: 0 });
});
test("rollback errors cannot mask failure and disconnect still removes partial inserts", async () => {
  const { c, schema } = await fixture(); const query = c.query.bind(c);
  c.query = (s, v) => (s.startsWith("INSERT INTO public.master_products") || s === "ROLLBACK")
    ? Promise.reject(new Error("private provider details")) : query(s, v);
  await assert.rejects(run(c), e => e.message === "RECOVERY_ABORTED" && !e.cause);
  assert.deepEqual(await count(schema), { categories: 0, products: 0 });
});
test("postcommit cleanup failure is distinguished from transaction rollback", async () => {
  const { c, schema } = await fixture(); const end = c.end.bind(c);
  c.end = async () => { await end(); throw new Error("private cleanup"); };
  await assert.rejects(run(c), /COMMITTED_CLEANUP_FAILED/);
  assert.deepEqual(await count(schema), { categories: 63, products: 687 });
});
test("unrelated business and ledger sentinel records remain unchanged", async () => {
  const { c, schema } = await fixture();
  await c.query(`CREATE TABLE ${schema}.business_sentinel(id integer, value text);
    CREATE TABLE ${schema}.ledger_sentinel(id integer, hash text);
    INSERT INTO ${schema}.business_sentinel VALUES(1,'untouched');
    INSERT INTO ${schema}.ledger_sentinel VALUES(27,'unexplained'),(28,'unexplained')`);
  await run(c);
  const inspect = await client();
  try {
    assert.deepEqual((await inspect.query(`SELECT * FROM ${schema}.business_sentinel`)).rows,
      [{ id: 1, value: "untouched" }]);
    assert.deepEqual((await inspect.query(`SELECT * FROM ${schema}.ledger_sentinel ORDER BY id`)).rows,
      [{ id: 27, hash: "unexplained" }, { id: 28, hash: "unexplained" }]);
  } finally { await inspect.end(); }
});
test("SQL statements are fixed insert-only with explicit columns", () => {
  assert.equal(COLUMNS.master_categories.length, 5);
  assert.equal(COLUMNS.master_products.length, 10);
  const source = readFileSync(new URL("./master-catalog-recovery.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ON CONFLICT|TRUNCATE|DELETE FROM|UPDATE public|process\.env|console\./);
});
