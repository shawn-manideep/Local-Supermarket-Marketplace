import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { usernameSchema } from "@workspace/validation";
import { partnerRepository, publicPartner } from "./repository.js";
import { provisionPartner, loginPartner, type PartnerAuthGateway } from "./auth-service.js";

const exec = promisify(execFile);
let directory: string, pool: pg.Pool, repo: ReturnType<typeof partnerRepository>;
before(async () => {
  directory = await mkdtemp(`${tmpdir()}/partner-foundation-`);
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  await exec("initdb", ["-D", `${directory}/data`, "--auth=trust", "--no-locale", "-U", "partner_test"]);
  await exec("pg_ctl", ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`, "-o", `-h 127.0.0.1 -k ${directory} -p ${port}`, "-w", "start"]);
  pool = new pg.Pool({ host: "127.0.0.1", port, database: "postgres", user: "partner_test", ssl: false, max: 8 });
  await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TYPE app_role AS ENUM('customer','vendor','admin');
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,role app_role NOT NULL DEFAULT 'customer',updated_at timestamptz DEFAULT now());
    CREATE TABLE customers(id uuid PRIMARY KEY REFERENCES user_profiles);
    CREATE TABLE orders(id uuid PRIMARY KEY);
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION current_app_role() RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT role FROM user_profiles WHERE id=auth.uid() $$;`);
  for (const file of ["0012_delivery_partner_role", "0013_delivery_partner_foundation"])
    await pool.query(await readFile(new URL(`../../../../database/migrations/${file}.sql`, import.meta.url), "utf8"));
  repo = partnerRepository(drizzle(pool));
}, { timeout: 60_000 });
after(async () => {
  await pool?.end();
  if (directory) {
    await exec("pg_ctl", ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
function authFixture() {
  const users = new Map<string, { password: string; active: boolean }>();
  const gateway: PartnerAuthGateway = {
    async create(password) { const id = randomUUID(); users.set(id, { password, active: false }); return id; },
    async activate(id) { users.get(id)!.active = true; },
    async remove(id) { users.delete(id); },
    async signIn(id, password) {
      const user = id ? users.get(id) : null;
      return user?.active && user.password === password ? { userId: id!, access_token: "fake-access-token", refresh_token: "fake-refresh-token" } : null;
    },
  };
  return { gateway, users };
}
function input(username = `partner_${randomUUID().replaceAll("-", "").slice(0, 10)}`) {
  return { username: usernameSchema.parse(username), password: "TestOnlyPassword12!", displayName: "Test Partner", status: "ACTIVE" as const, contactNumber: null };
}
test("provisioning creates one profile, role and global username but no password fields", async () => {
  const { gateway } = authFixture();
  const partner = await provisionPartner(repo, gateway, input());
  assert.equal(partner.status, "ACTIVE");
  assert.equal((await pool.query("SELECT role FROM user_profiles WHERE id=$1", [partner.id])).rows[0].role, "delivery_partner");
  const registry = (await pool.query("SELECT * FROM identity_usernames WHERE user_id=$1", [partner.id])).rows[0];
  assert.deepEqual(Object.keys(registry).sort(), ["created_at", "normalized_username", "updated_at", "user_id"]);
  assert.doesNotMatch(JSON.stringify(publicPartner(partner)), /userId|createdAt|updatedAt|password|id":/);
});
test("case-insensitive concurrent username provisioning permits exactly one Auth identity and partner", async () => {
  const { gateway, users } = authFixture();
  const username = input().username;
  const outcomes = await Promise.allSettled([provisionPartner(repo, gateway, input(username.toUpperCase())), provisionPartner(repo, gateway, input(username))]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal(users.size, 1);
  const failure = outcomes.find(outcome => outcome.status === "rejected") as PromiseRejectedResult;
  assert.equal(failure.reason.code, "USERNAME_TAKEN");
});
test("global registry prevents collision with customer, vendor and admin identities", async () => {
  for (const role of ["customer", "vendor", "admin"]) {
    const id = randomUUID(), request = input();
    await pool.query("INSERT INTO user_profiles(id,role) VALUES($1,$2)", [id, role]);
    await pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,$2)", [id, request.username]);
    const { gateway, users } = authFixture();
    await assert.rejects(provisionPartner(repo, gateway, request), { code: "USERNAME_TAKEN" });
    assert.equal(users.size, 0);
  }
});
test("a concurrent non-partner username claim gets a clean duplicate error and preserves the other identity", async () => {
  const { gateway, users } = authFixture(), request = input(), otherId = randomUUID();
  const create = gateway.create;
  gateway.create = async password => {
    const id = await create(password);
    // Simulates a future role's writer relying on the DB unique constraint,
    // rather than participating in the partner service's advisory lock.
    await pool.query("INSERT INTO user_profiles(id,role) VALUES($1,'customer')", [otherId]);
    await pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,$2)", [otherId, request.username]);
    return id;
  };
  await assert.rejects(provisionPartner(repo, gateway, request), { statusCode: 409, code: "USERNAME_TAKEN" });
  assert.equal(users.size, 0);
  assert.equal((await repo.identity(request.username))!.id, otherId);
});
test("database rejects duplicate, nonnormalized/reserved username and username mutation", async () => {
  const { gateway } = authFixture();
  const partner = await provisionPartner(repo, gateway, input());
  const id = randomUUID();
  await pool.query("INSERT INTO user_profiles(id) VALUES($1)", [id]);
  await assert.rejects(pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,$2)", [id, partner.username]), { code: "23505" });
  for (const name of ["UPPER_case", "admin", "1bad", "bad name"])
    await assert.rejects(pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,$2)", [id, name]), { code: "23514" });
  await assert.rejects(pool.query("UPDATE identity_usernames SET normalized_username='new_name' WHERE user_id=$1", [partner.id]), /immutable/);
});
test("username/password delegates authentication; only correct credentials return session tokens", async () => {
  const request = input(), { gateway } = authFixture();
  await provisionPartner(repo, gateway, request);
  assert.deepEqual(await loginPartner(repo, gateway, request.username, request.password), { session: { access_token: "fake-access-token", refresh_token: "fake-refresh-token" } });
  for (const [username, password] of [[request.username, "wrong"], ["missing_user", request.password]])
    await assert.rejects(loginPartner(repo, gateway, username!, password!), { statusCode: 401, message: "Invalid username or password." });
});
test("inactive partner gets clear denial only after verified credentials; reactivation works", async () => {
  const request = input(), { gateway } = authFixture();
  const partner = await provisionPartner(repo, gateway, request);
  await repo.status(partner.id, "INACTIVE");
  await assert.rejects(loginPartner(repo, gateway, request.username, request.password), { code: "PARTNER_INACTIVE" });
  await assert.rejects(loginPartner(repo, gateway, request.username, "wrong"), { statusCode: 401, message: "Invalid username or password." });
  await repo.status(partner.id, "ACTIVE");
  assert.ok((await loginPartner(repo, gateway, request.username, request.password)).session);
});
test("provisioning failure compensates Auth identity and all DB application records", async () => {
  const { gateway, users } = authFixture(), request = input();
  gateway.activate = async () => { throw new Error("Synthetic Auth activation failure"); };
  await assert.rejects(provisionPartner(repo, gateway, request), /Synthetic Auth activation failure/);
  assert.equal(users.size, 0);
  assert.equal(await repo.identity(request.username), undefined);
});
test("DB failure after Auth creation rolls back profile/username and removes trigger-created shell", async () => {
  const { gateway, users } = authFixture(), request = input();
  const create = gateway.create;
  let createdId: string | undefined;
  gateway.create = async password => {
    createdId = await create(password);
    // Auth's customer-shell trigger commits independently of the application transaction.
    await pool.query("INSERT INTO user_profiles(id) VALUES($1)", [createdId]);
    await pool.query("INSERT INTO customers(id) VALUES($1)", [createdId]);
    return createdId;
  };
  await assert.rejects(provisionPartner(repo, gateway, { ...request, displayName: "" }));
  assert.equal(users.size, 0);
  assert.equal(await repo.identity(request.username), undefined);
  assert.equal((await pool.query("SELECT id FROM user_profiles WHERE id=$1", [createdId])).rows.length, 0);
  assert.equal((await pool.query("SELECT id FROM customers WHERE id=$1", [createdId])).rows.length, 0);
});
test("dashboard and deliveries are genuinely empty when no assignments exist", async () => {
  const { gateway } = authFixture();
  const partner = await provisionPartner(repo, gateway, input());
  assert.deepEqual(await repo.dashboard(partner.id), { total: 0, pending: 0, assigned: 0, inProgress: 0, completed: 0, cancelled: 0, rejected: 0 });
  assert.deepEqual(await repo.deliveries(partner.id), []);
});
test("own-assignment reads and dashboard counts never include another partner or customer/order details", async () => {
  const { gateway } = authFixture();
  const a = await provisionPartner(repo, gateway, input()), b = await provisionPartner(repo, gateway, input());
  const order = randomUUID(), aAssignment = randomUUID();
  await pool.query("INSERT INTO orders(id) VALUES($1)", [order]);
  await pool.query("INSERT INTO delivery_assignments(id,order_id,partner_user_id,status) VALUES($1,$2,$3,'ASSIGNED'),($4,$2,$5,'DELIVERED')", [aAssignment, order, a.id, randomUUID(), b.id]);
  const rows = await repo.deliveries(a.id);
  assert.equal(rows.length, 1); assert.equal(rows[0]!.id, aAssignment);
  assert.doesNotMatch(JSON.stringify(rows), /order_id|orderId|partner_user_id|phone|address|customer/);
  assert.equal((await repo.dashboard(a.id)).assigned, 1);
  assert.equal((await repo.dashboard(a.id)).completed, 0);
  await repo.status(a.id, "INACTIVE");
  assert.deepEqual(await repo.deliveries(a.id), []);
});
test("RLS isolates partner profiles, usernames and assignments and denies direct mutations", async () => {
  const { gateway } = authFixture();
  const a = await provisionPartner(repo, gateway, input()), b = await provisionPartner(repo, gateway, input());
  const client = await pool.connect();
  try {
    await client.query("SET ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [a.id]);
    assert.deepEqual((await client.query("SELECT user_id FROM delivery_partner_profiles")).rows, [{ user_id: a.id }]);
    assert.deepEqual((await client.query("SELECT user_id FROM identity_usernames")).rows, [{ user_id: a.id }]);
    assert.equal((await client.query("SELECT id FROM delivery_assignments")).rows.length, 0);
    await assert.rejects(client.query("SELECT order_id FROM delivery_assignments"), { code: "42501" });
    await assert.rejects(client.query("UPDATE delivery_partner_profiles SET status='ACTIVE' WHERE user_id=$1", [b.id]), { code: "42501" });
    await assert.rejects(client.query("INSERT INTO delivery_assignments(order_id,partner_user_id) VALUES($1,$2)", [randomUUID(), a.id]), { code: "42501" });
  } finally { await client.query("RESET ROLE"); client.release(); }
});