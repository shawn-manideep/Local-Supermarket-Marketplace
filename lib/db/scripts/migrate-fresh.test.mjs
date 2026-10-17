import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import net from "node:net";
import pg from "pg";
import {
  approveTarget, loadMigrations, migrationDirectory, runFresh, protectedProject,
} from "./migrate-fresh.mjs";

const exec = promisify(execFile);
const binaries = process.env.FRESH_TEST_POSTGRES_BIN ??
  "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";
// Explicit allowlist: no managed connection settings, credentials, PG* or dotenv.
const toolEnv = Object.fromEntries(["PATH", "HOME", "USER", "LANG", "TMPDIR"]
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
const token = randomBytes(16).toString("hex");
const ref = `local-${token}`;
const database = `fresh_test_${token}`;
const args = ["--apply", "--project-ref", ref, "--approve-project-ref", ref, "--local-test-token", token];
const root = new URL("../../../", import.meta.url);
let directory, port, admin, started = false, target, migrations;

before(async () => {
  const { stdout } = await exec(`${binaries}/postgres`, ["--version"], { env: toolEnv });
  assert.match(stdout, /PostgreSQL\) 17\./, "Disposable tests require PostgreSQL 17; never use a remote fallback");
  directory = await mkdtemp(`${tmpdir()}/alb-fresh-runner-`);
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  await exec(`${binaries}/initdb`, ["-D", `${directory}/data`, "--auth=trust", "--no-locale", "-U", "postgres"],
    { env: toolEnv });
  await exec(`${binaries}/pg_ctl`, ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`,
    "-o", `-h 127.0.0.1 -k ${directory} -p ${port} -c alb.fresh_test_cluster_id=${token}`, "-w", "start"],
  { env: toolEnv });
  started = true;
  const url = `postgresql://postgres@127.0.0.1:${port}/${database}`;
  target = approveTarget(args, { FRESH_DB_URL: url });
  admin = new pg.Client({ ...target.config, database: "postgres" });
  await admin.connect();
  await admin.query("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS");
  migrations = await loadMigrations();
});

after(async () => {
  await admin?.end();
  try {
    if (started) await exec(`${binaries}/pg_ctl`, ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"],
      { env: toolEnv });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function withClient(callback) {
  const client = new pg.Client(target.config);
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}

async function freshDatabase() {
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  await withClient(client => client.query(`
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  `));
}

async function prefix(tag = "0012_delivery_partner_role", selected = migrations) {
  await assert.rejects(runFresh({ target, migrations: selected, onApplied(migration) {
    if (migration.tag === tag) throw new Error("TEST_INTERRUPTION_AFTER_COMMIT");
  } }), /TEST_INTERRUPTION_AFTER_COMMIT/);
}

async function copyMigrations() {
  const destination = await mkdtemp(`${directory}/migrations-`);
  await cp(migrationDirectory, destination, { recursive: true });
  return destination;
}

test("inventory includes every SQL exactly once and preserves original journal and commands", async () => {
  assert.equal(migrations.length, 26);
  const journal = JSON.parse(await readFile(`${migrationDirectory}/meta/_journal.json`, "utf8"));
  assert.equal(createHash("sha256").update(JSON.stringify(journal.entries.slice(0, 17))).digest("hex"),
    "d864ab6ff904105a5ebda6f78467db2149b63639522291006e323677a7b5cbb9");
  assert.deepEqual(migrations.slice(17).map(entry => entry.tag.slice(0, 4)),
    ["0016", "0017", "0018", "0019", "0020", "0021", "0022", "0024", "0025"]);
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  // Package below is resolved explicitly, independently of the repository root.
  const dbPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(dbPackage.scripts, {
    build: "tsc -p ./tsconfig.json",
    generate: "drizzle-kit generate --config ./drizzle.config.ts",
    check: "drizzle-kit check --config ./drizzle.config.ts",
    migrate: "drizzle-kit migrate --config ./drizzle.config.ts",
    "migrate:fresh": "node ./scripts/migrate-fresh.mjs",
    push: "drizzle-kit push --config ./drizzle.config.ts",
    "push-force": "drizzle-kit push --force --config ./drizzle.config.ts",
  });
  assert.ok(!pkg.scripts?.["migrate:fresh"], "No root/production migration command added");
  const { stdout } = await exec(process.execPath, [new URL("./migrate-fresh.mjs", import.meta.url).pathname, "--check"],
    { env: toolEnv });
  assert.match(stdout, /26 registered SQL files.*No database connection/);
  const copy = await copyMigrations();
  const cloned = JSON.parse(await readFile(`${copy}/meta/_journal.json`, "utf8"));
  cloned.entries.push({ ...cloned.entries[0], idx: 26 });
  await writeFile(`${copy}/meta/_journal.json`, JSON.stringify(cloned));
  await assert.rejects(loadMigrations(copy), /INVENTORY_MISMATCH/);
});

test("exact approval, protected projects, URL identity and ambiguous connections fail before connecting", () => {
  const example = "abcdefghijklmnopqrst";
  const remoteArgs = ["--apply", "--project-ref", example, "--approve-project-ref", example];
  const env = { FRESH_DB_URL: `postgresql://postgres:synthetic@db.${example}.supabase.co:5432/postgres`,
    FRESH_SUPABASE_URL: `https://${example}.supabase.co` };
  assert.equal(approveTarget(remoteArgs, env).config.ssl.rejectUnauthorized, true);
  assert.equal(approveTarget(remoteArgs, { ...env,
    FRESH_DB_URL: `postgresql://postgres.${example}:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  }).config.port, 5432);
  for (const badArgs of [
    remoteArgs.filter(value => value !== "--apply"), [...remoteArgs, "--apply"],
    ["--apply", "--project-ref", example, "--approve-project-ref", "different"],
    ["--apply", "--project-ref", protectedProject, "--approve-project-ref", protectedProject],
  ]) assert.throws(() => approveTarget(badArgs, env));
  for (const badEnv of [
    {}, { SUPABASE_DB_URL: env.FRESH_DB_URL },
    { ...env, FRESH_SUPABASE_URL: "https://different.supabase.co" },
    { ...env, FRESH_DB_URL: `postgresql://postgres:synthetic@db.${protectedProject}.supabase.co/postgres` },
    { ...env, FRESH_DB_URL: env.FRESH_DB_URL + "?sslmode=disable" },
    { ...env, FRESH_DB_URL: env.FRESH_DB_URL.replace("5432", "6543") },
    { ...env, FRESH_DB_URL: env.FRESH_DB_URL.replace(`db.${example}.supabase.co`, "localhost") },
    { ...env, FRESH_DB_URL: env.FRESH_DB_URL.replace("/postgres", "/different") },
  ]) assert.throws(() => approveTarget(remoteArgs, badEnv));
  assert.throws(() => approveTarget(args, { FRESH_DB_URL: env.FRESH_DB_URL }), /LOCAL_TEST_TARGET/);
});

test("CLI errors never disclose supplied credentials, URLs or driver messages", async () => {
  const secretSentinel = "SYNTHETIC_PASSWORD_DO_NOT_LOG";
  const result = await exec(process.execPath, [new URL("./migrate-fresh.mjs", import.meta.url).pathname,
    "--apply", "--project-ref", protectedProject, "--approve-project-ref", protectedProject],
  { env: { ...toolEnv, FRESH_DB_URL: `postgresql://postgres:${secretSentinel}@127.0.0.1:1/postgres` } })
    .catch(error => error);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /PROTECTED_PROJECT/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secretSentinel));
  assert.ok(!`${result.stdout}${result.stderr}`.includes("postgresql://"));
});

test("actual fresh runner applies all 26; complete schema exists, no fixtures, rerun is a no-op", async () => {
  await freshDatabase();
  assert.deepEqual(await runFresh({ target, migrations }), { applied: 26, alreadyApplied: 0, total: 26 });
  await withClient(async client => {
    for (const name of [
      "user_profiles", "product_variants", "master_products", "customer_repeat_requests",
      "identity_usernames", "delivery_partner_profiles", "delivery_assignments", "platform_management_events",
      "catalog_import_events", "vendor_documents", "customer_saved_items", "vendor_bank_details",
      "delivery_pickup_photos", "vendor_notifications",
    ]) {
      assert.equal((await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${name}`]))
        .rows[0].present, true, name);
    }
    const columns = (await client.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public'`)).rows.map(row => `${row.table_name}.${row.column_name}`);
    for (const column of ["stores.handling_fee", "stores.latitude", "stores.document_verification_status",
      "customer_addresses.house_number", "customer_addresses.building_name", "vendor_documents.expiry_date",
      "orders.delivery_mode", "orders.inventory_state", "orders.handling_fee_snapshot"]) {
      assert.ok(columns.includes(column), column);
    }
    assert.equal((await client.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 26);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM auth.users")).rows[0].count, 0);
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n
      ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity`)).rows[0].count, 0);
    assert.equal((await client.query(`SELECT to_regprocedure('public.vendor_compliance_approved(uuid)')
      IS NOT NULL AS present`)).rows[0].present, true);
  });
  assert.deepEqual(await runFresh({ target, migrations }), { applied: 0, alreadyApplied: 26, total: 26 });
  const { stdout } = await exec(process.execPath,
    [new URL("./migrate-fresh.mjs", import.meta.url).pathname, ...args],
    { env: { ...toolEnv, FRESH_DB_URL: `postgresql://postgres@127.0.0.1:${port}/${database}` } });
  assert.match(stdout, /0 applied, 26 already applied/);
});

test("0012 is committed and visible before 0013; valid-prefix resume completes", async () => {
  await freshDatabase();
  await prefix();
  await withClient(async client => {
    assert.equal((await client.query("SELECT 'delivery_partner'::public.app_role::text AS role")).rows[0].role,
      "delivery_partner");
    assert.equal((await client.query("SELECT to_regclass('public.delivery_partner_profiles') AS relation")).rows[0].relation, null);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 13);
  });
  assert.deepEqual(await runFresh({ target, migrations }), { applied: 13, alreadyApplied: 13, total: 26 });
});

test("SQL failure rolls back its whole file and history entry without touching earlier commits", async () => {
  await freshDatabase();
  const copy = await copyMigrations();
  const filename = `${copy}/0025_fssai_expiry_and_vendor_notifications.sql`;
  await writeFile(filename, (await readFile(filename, "utf8")) +
    "\nCREATE TABLE public.rollback_probe(id int); SELECT 1/0;\n");
  const changed = await loadMigrations(copy);
  await assert.rejects(runFresh({ target, migrations: changed }), /division by zero/);
  await withClient(async client => {
    assert.equal((await client.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 25);
    for (const name of ["public.rollback_probe", "public.vendor_notifications"]) {
      assert.equal((await client.query("SELECT to_regclass($1) AS relation", [name])).rows[0].relation, null);
    }
    assert.equal((await client.query("SELECT to_regclass('public.vendor_bank_details') IS NOT NULL AS present"))
      .rows[0].present, true);
  });
  // Even an unapplied file is pinned by the bootstrap manifest; never silently repair it.
  await assert.rejects(runFresh({ target, migrations }), /MANIFEST_OR_TARGET_CHANGED/);
});

test("a deferred history-insert failure rolls back schema AND ledger; unchanged resume succeeds", async () => {
  await freshDatabase();
  await prefix();
  await withClient(client => client.query(`
    CREATE FUNCTION public.test_ledger_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic deferred ledger failure'; END $$;
    CREATE CONSTRAINT TRIGGER test_ledger_failure AFTER INSERT ON drizzle.__drizzle_migrations
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.test_ledger_failure();
  `));
  await assert.rejects(runFresh({ target, migrations }), /synthetic deferred ledger failure/);
  await withClient(async client => {
    assert.equal((await client.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 13);
    assert.equal((await client.query("SELECT to_regclass('public.identity_usernames') AS relation")).rows[0].relation, null);
    await client.query(`DROP TRIGGER test_ledger_failure ON drizzle.__drizzle_migrations;
      DROP FUNCTION public.test_ledger_failure()`);
  });
  assert.equal((await runFresh({ target, migrations })).applied, 13);
});

test("changed SQL hashes, ledger hashes, timestamps, unknown rows, and missing prefix are rejected", async () => {
  for (const sql of [
    "UPDATE drizzle.__drizzle_migrations SET hash='changed' WHERE id=1",
    "UPDATE drizzle.__drizzle_migrations SET created_at=1 WHERE id=1",
    "INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES('unknown',9999999999999)",
    "DELETE FROM drizzle.__drizzle_migrations WHERE id=1",
  ]) {
    await freshDatabase();
    await prefix();
    await withClient(client => client.query(sql));
    await assert.rejects(runFresh({ target, migrations }), /NONPREFIX_HISTORY/);
  }
  await freshDatabase();
  await prefix();
  const copy = await copyMigrations();
  const filename = `${copy}/0000_furry_doomsday.sql`;
  await writeFile(filename, (await readFile(filename, "utf8")) + "\n-- changed checksum\n");
  await assert.rejects(runFresh({ target, migrations: await loadMigrations(copy) }), /MANIFEST_OR_TARGET_CHANGED/);
});

test("preexisting schema, Auth data, Supabase history, and unowned ledgers are never adopted", async () => {
  for (const sql of [
    "CREATE TABLE public.unowned(id int)",
    "CREATE SCHEMA private_application; CREATE TABLE private_application.records(id int)",
    `INSERT INTO auth.users(id,email) VALUES('${randomUUID()}','synthetic@qa.invalid')`,
    "CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text); INSERT INTO supabase_migrations.schema_migrations VALUES('existing')",
    "CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id int,hash text,created_at bigint)",
  ]) {
    await freshDatabase();
    await withClient(client => client.query(sql));
    await assert.rejects(runFresh({ target, migrations }),
      /SCHEMA_NOT_EMPTY|NONEMPTY_TARGET|INCONSISTENT_LEDGER|UNKNOWN_APPLICATION_SCHEMA/);
    await withClient(async client => {
      assert.equal((await client.query("SELECT to_regclass('drizzle.__fresh_bootstrap') AS relation")).rows[0].relation, null);
    });
  }
});

test("altered marker identities, unknown history objects, empty inconsistent history and fabricated targets fail closed", async () => {
  await assert.rejects(runFresh({ target: { ...target }, migrations }), /TARGET_NOT_APPROVED/);
  await assert.rejects(runFresh({ target, migrations: [{ ...migrations[0], sql: "SELECT 1" }] }),
    /HASH_MISMATCH/);
  for (const [tag, sql, expected] of [
    ["0012_delivery_partner_role", "UPDATE drizzle.__fresh_bootstrap SET project_ref='wrong'", /MANIFEST_OR_TARGET_CHANGED/],
    ["0012_delivery_partner_role", "CREATE TABLE drizzle.unknown_history(id int)", /UNKNOWN_HISTORY_OBJECTS/],
    ["0000_furry_doomsday", "DELETE FROM drizzle.__drizzle_migrations", /SCHEMA_NOT_EMPTY/],
  ]) {
    await freshDatabase();
    await prefix(tag);
    await withClient(client => client.query(sql));
    await assert.rejects(runFresh({ target, migrations }), expected);
  }
});

test("wrong server proof is rejected without creating migration metadata", async () => {
  await freshDatabase();
  const wrongToken = randomBytes(16).toString("hex");
  const wrongArgs = ["--apply", "--project-ref", `local-${wrongToken}`, "--approve-project-ref",
    `local-${wrongToken}`, "--local-test-token", wrongToken];
  const wrong = approveTarget(wrongArgs, {
    FRESH_DB_URL: `postgresql://postgres@127.0.0.1:${port}/fresh_test_${wrongToken}`,
  });
  await admin.query(`CREATE DATABASE "fresh_test_${wrongToken}" TEMPLATE template0`);
  await assert.rejects(runFresh({ target: wrong, migrations }), /CLUSTER_PROOF_MISMATCH/);
});

test("two actual runners cannot execute concurrently; advisory lock survives per-file commits", async () => {
  await freshDatabase();
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { reached = resolve; });
  const first = runFresh({ target, migrations, async onApplied(migration) {
    if (migration.idx === 0) { reached(); await gate; }
  } });
  await ready;
  try { await assert.rejects(runFresh({ target, migrations }), /MIGRATION_RUNNER_BUSY/); }
  finally { release(); }
  assert.equal((await first).applied, 26);
});

test("representative Customer RLS, API-only writes, compliance default and immutable snapshot trigger", async () => {
  await freshDatabase();
  await runFresh({ target, migrations });
  const customer = randomUUID(), other = randomUUID(), vendor = randomUUID(), store = randomUUID(), order = randomUUID();
  await withClient(async client => {
    for (const id of [customer, other, vendor]) {
      await client.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, `${id}@qa.invalid`]);
    }
    await client.query("UPDATE public.user_profiles SET role='vendor' WHERE id=$1", [vendor]);
    await client.query("INSERT INTO public.stores(id,owner_user_id,name) VALUES($1,$2,'Synthetic test store')", [store, vendor]);
    assert.equal((await client.query("SELECT documents_required FROM public.stores WHERE id=$1", [store]))
      .rows[0].documents_required, true);
    assert.equal((await client.query("SELECT public.vendor_compliance_approved($1) AS approved", [store]))
      .rows[0].approved, false);
    await client.query("SET ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [customer]);
    assert.deepEqual((await client.query("SELECT id FROM public.customers")).rows.map(row => row.id), [customer]);
    await assert.rejects(client.query("INSERT INTO public.customer_saved_items(customer_id,product_id) VALUES($1,$2)",
      [customer, randomUUID()]), /permission denied/);
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('request.jwt.claim.sub','',false)");
    await client.query(`INSERT INTO public.orders(id,customer_id,store_id,subtotal,delivery_fee_snapshot,total_amount,
      delivery_address_snapshot,delivery_contact_name,delivery_contact_phone)
      VALUES($1,$2,$3,100,0,100,'{}','Synthetic','0000000000')`, [order, customer, store]);
    await assert.rejects(client.query("UPDATE public.orders SET total_amount=101 WHERE id=$1", [order]),
      /immutable|cannot|snapshot/i);
  });
});
