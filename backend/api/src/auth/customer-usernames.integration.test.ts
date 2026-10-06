import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import net from "node:net";
import pg from "pg";
import { usernameSchema } from "@workspace/validation";

const exec = promisify(execFile);
const bin = process.env.ADMIN_QA_POSTGRES_BIN ?? "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";
let directory: string, pool: pg.Pool, running = false;
let env: NodeJS.ProcessEnv;
const legacyIds: string[] = [];
let beforeRows: unknown[], beforeCustomers: unknown[];
const existingVendor = randomUUID(), existingCustomer = randomUUID();

before(async () => {
  directory = await mkdtemp(`${tmpdir()}/customer-username-qa-`);
  const listener = net.createServer();
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  env = { ...process.env, PGUSER: "username_qa", PGHOST: "127.0.0.1", PGPORT: String(port), PGDATABASE: "postgres", PGSSLMODE: "disable" };
  await exec(`${bin}/initdb`, ["-D", `${directory}/data`, "-U", "username_qa", "-A", "trust", "--no-locale"], { env });
  await exec(`${bin}/pg_ctl`, ["-D", `${directory}/data`, "-l", `${directory}/server.log`, "-o", `-p ${port} -h 127.0.0.1 -k ${directory}`, "-w", "start"], { env });
  running = true;
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "username_qa", database: "postgres", ssl: false });
  await pool.query(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),role text);
    CREATE TABLE public.customers(id uuid PRIMARY KEY REFERENCES user_profiles(id),full_name text);
  `);
  const foundation = await readFile(new URL("../../../../database/migrations/0013_delivery_partner_foundation.sql", import.meta.url), "utf8");
  await pool.query(foundation.split("CREATE TABLE public.delivery_partner_profiles")[0]!);
  await pool.query("INSERT INTO auth.users(id,email) VALUES($1,'vendor@example.test'),($2,'unchanged@example.test')", [existingVendor, existingCustomer]);
  await pool.query("INSERT INTO user_profiles(id,role) VALUES($1,'vendor'),($2,'customer')", [existingVendor, existingCustomer]);
  await pool.query("INSERT INTO customers(id,full_name) VALUES($1,'Existing Customer')", [existingCustomer]);
  await pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,'john'),($2,'keep_username')", [existingVendor, existingCustomer]);
  for (const [index, email] of ["John@example.test", "John@another.test", "ROOT@example.test", "1@example.test", "a@example.test", "Mixed-Name@example.test", `${"longname".repeat(8)}@example.test`].entries()) {
    const id = randomUUID(); legacyIds.push(id);
    await pool.query("INSERT INTO auth.users(id,email,created_at) VALUES($1,$2,to_timestamp($3))", [id, email, 1000 + index]);
    await pool.query("INSERT INTO user_profiles(id,role) VALUES($1,'customer')", [id]);
    await pool.query("INSERT INTO customers(id,full_name) VALUES($1,'Preserved customer')", [id]);
  }
  beforeRows = (await pool.query("SELECT * FROM auth.users ORDER BY id")).rows;
  beforeCustomers = (await pool.query("SELECT * FROM customers ORDER BY id")).rows;
  await pool.query(await readFile(new URL("../../../../database/migrations/0018_customer_usernames.sql", import.meta.url), "utf8"));
  await pool.query("CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()");
});

after(async () => {
  await pool?.end();
  if (running) await exec(`${bin}/pg_ctl`, ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"], { env });
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("migration backfills every existing Customer without changing Auth/customer rows or existing shared usernames", async () => {
  assert.deepEqual((await pool.query("SELECT * FROM auth.users ORDER BY id")).rows, beforeRows);
  assert.deepEqual((await pool.query("SELECT * FROM customers ORDER BY id")).rows, beforeCustomers);
  const rows = (await pool.query("SELECT user_id,normalized_username FROM identity_usernames")).rows as Array<{ user_id: string; normalized_username: string }>;
  assert.equal(rows.find(row => row.user_id === existingVendor)?.normalized_username, "john");
  assert.equal(rows.find(row => row.user_id === existingCustomer)?.normalized_username, "keep_username");
  for (const id of legacyIds) assert.ok(usernameSchema.safeParse(rows.find(row => row.user_id === id)?.normalized_username).success);
  assert.equal(new Set(rows.map(row => row.normalized_username)).size, rows.length);
  assert.equal(rows.find(row => row.user_id === legacyIds[0])?.normalized_username, "john_1");
  assert.equal(rows.find(row => row.user_id === legacyIds[1])?.normalized_username, "john_2");
});

test("new explicit Customer signup reserves its chosen normalized username in the same shared table", async () => {
  const id = randomUUID();
  await pool.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'new@example.test',$2)", [id, { customer_signup: true, username: "New_Customer" }]);
  assert.equal((await pool.query("SELECT normalized_username FROM identity_usernames WHERE user_id=$1", [id])).rows[0]?.normalized_username, "new_customer");
  assert.equal((await pool.query("SELECT role FROM user_profiles WHERE id=$1", [id])).rows[0]?.role, "customer");
  assert.equal((await pool.query("SELECT id FROM customers WHERE id=$1", [id])).rowCount, 1);
});

test("invalid/reserved/taken Customer signup usernames roll back the new identity atomically", async () => {
  for (const username of ["ab", "admin", "bad name", "john"]) {
    const id = randomUUID();
    await assert.rejects(pool.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'failed@example.test',$2)", [id, { customer_signup: true, username }]));
    assert.equal((await pool.query("SELECT id FROM auth.users WHERE id=$1", [id])).rowCount, 0);
    assert.equal((await pool.query("SELECT id FROM customers WHERE id=$1", [id])).rowCount, 0);
  }
});

test("Admin-provisioned Vendor/Partner identities do not receive an automatic Customer username", async () => {
  const id = randomUUID();
  await pool.query("INSERT INTO auth.users(id,email) VALUES($1,'partner-placeholder@accounts.localbasket.invalid')", [id]);
  assert.equal((await pool.query("SELECT user_id FROM identity_usernames WHERE user_id=$1", [id])).rowCount, 0);
  await pool.query("UPDATE user_profiles SET role='delivery_partner' WHERE id=$1", [id]);
  await pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,'partner_created')", [id]);
  assert.equal((await pool.query("SELECT normalized_username FROM identity_usernames WHERE user_id=$1", [id])).rows[0]?.normalized_username, "partner_created");
});

test("username bindings remain immutable and privileged assignment helpers are not public RPCs", async () => {
  await assert.rejects(pool.query("UPDATE identity_usernames SET normalized_username='changed_name' WHERE user_id=$1", [existingCustomer]), /immutable/);
  const result = await pool.query("SELECT has_function_privilege('authenticated','public.assign_customer_username(uuid,text)','execute') AS allowed");
  assert.equal(result.rows[0]?.allowed, false);
});
