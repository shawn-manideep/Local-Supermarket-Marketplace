import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import net from "node:net";
import pg from "pg";
import type { Server } from "node:http";
import { createApp } from "../app.js";

const exec = promisify(execFile);
let directory: string, pool: pg.Pool, server: Server, base: string;
const originalFetch = globalThis.fetch;
const actors = new Map<string, string>();
const admin = randomUUID(), customer = randomUUID(), vendor = randomUUID(), partner = randomUUID();
const otherCustomer = randomUUID(), noStoreVendor = randomUUID(), rejectedVendor = randomUUID();
const store = randomUUID(), rejectedStore = randomUUID(), order = randomUUID();
const postgres = process.env.ADMIN_QA_POSTGRES_BIN ?? "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";
let createdPartner: string;
before(async () => {
  directory = await mkdtemp(`${tmpdir()}/admin-management-`);
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  await exec(`${postgres}/initdb`, ["-D", `${directory}/data`, "--auth=trust", "--no-locale", "-U", "admin_qa"]);
  await exec(`${postgres}/pg_ctl`, ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`, "-o", `-h 127.0.0.1 -k ${directory} -p ${port}`, "-w", "start"]);
  pool = new pg.Pool({ host: "127.0.0.1", port, database: "postgres", user: "admin_qa", ssl: false });
  await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE postgres SUPERUSER;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const migrations = new URL("../../../../database/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter(f => /^\d.*\.sql$/.test(f)).sort()) {
    await pool.query(await readFile(new URL(file, migrations), "utf8"));
  }
  for (const [id, role] of [[admin, "admin"], [customer, "customer"], [otherCustomer, "customer"], [vendor, "vendor"], [partner, "delivery_partner"], [noStoreVendor, "vendor"], [rejectedVendor, "vendor"]]) {
    await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, `${role}-${id}@qa.invalid`]);
    await pool.query("UPDATE user_profiles SET role=$2::app_role WHERE id=$1", [id, role]);
    if (role !== "customer") await pool.query("DELETE FROM customers WHERE id=$1", [id]);
    actors.set(`qa-${id}`, id!);
  }
  await pool.query("UPDATE customers SET full_name='QA shopper' WHERE id=$1", [customer]);
  await pool.query("INSERT INTO stores(id,owner_user_id,name,status) VALUES($1,$2,'Neighborhood QA','PENDING_APPROVAL'),($3,$4,'Rejected QA','REJECTED')", [store, vendor, rejectedStore, rejectedVendor]);
  await pool.query("INSERT INTO delivery_partner_profiles(user_id,display_name) VALUES($1,'Assigned QA partner')", [partner]);
  await pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,'qa_partner')", [partner]);
  // Test-only identity-provider simulation; all application HTTP, SQL, RLS,
  // provisioning orchestration, status transitions and auditing run unmocked.
  process.env.SUPABASE_URL = "https://admin-qa.example.invalid";
  process.env.SUPABASE_ANON_KEY = "synthetic-test-publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-service-key";
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${process.env.SUPABASE_URL}/auth/v1/`)) {
      const headers = new Headers(init?.headers);
      const authToken = headers.get("authorization")?.replace(/^Bearer /, "");
      const id = actors.get(authToken ?? "");
      if (url.includes("/admin/users")) {
        const method = init?.method ?? "GET";
        if (method === "POST") {
          const newId = randomUUID(); createdPartner = newId;
          await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [newId, `${newId}@qa.invalid`]);
          return Response.json({ id: newId, email: `${newId}@qa.invalid` });
        }
        if (method === "DELETE") {
          await pool.query("DELETE FROM auth.users WHERE id=$1", [url.split("/").pop()]);
          return Response.json({});
        }
        return Response.json({ id: url.split("/").pop(), email: "qa@qa.invalid" });
      }
      if (url.endsWith("/user") && id) return Response.json({ id, email: `${id}@qa.invalid`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
      return Response.json({ message: "Invalid credentials" }, { status: 401 });
    }
    return originalFetch(input, init);
  };
  process.env.SUPABASE_DB_URL = `postgresql://admin_qa@127.0.0.1:${port}/postgres?sslmode=disable`;
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
}, { timeout: 60000 });
after(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  const { getPool } = await import("@workspace/db");
  await getPool().end();
  await pool?.end();
  if (directory) {
    await exec(`${postgres}/pg_ctl`, ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"]).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
type QaPayload = {
  error?: string; code?: string; auth: { role: string }; dashboard: Record<string, number>;
  account: { storeId: string | null; status: string | null; allowedStatuses: string[]; orderCount: number; email: string | null; username: string; activeAssignments: number };
  items: unknown[]; total: number; partner: { id: string; username: string }; partners: Array<{ id: string }>;
};
async function http(actor: string | null, path: string, method = "GET", body?: unknown, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(actor ? { Authorization: `Bearer qa-${actor}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = (response.status === 204 ? {} : await response.json()) as QaPayload;
  assert.equal(response.status, expected, `${method} ${path}: ${result?.error ?? ""}`);
  if (path.startsWith("/api/admin")) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!/"(?:password|encrypted_password|access_token|refresh_token|service_role_key)"/.test(JSON.stringify(result)));
  }
  return result;
}
test("Admin email-session identity resolves existing admin role; missing/invalid sessions denied", async () => {
  assert.equal((await http(admin, "/api/auth/me")).auth.role, "admin");
  await http(null, "/api/admin/dashboard", "GET", undefined, 401);
  await http(randomUUID(), "/api/admin/dashboard", "GET", undefined, 401);
});
test("customer/vendor/partner denied every administrative list/detail/status/provision endpoint", async () => {
  for (const actor of [customer, vendor, partner]) {
    for (const [path, method, body] of [
      ["/api/admin/dashboard", "GET"], ["/api/admin/vendors", "GET"], ["/api/admin/customers", "GET"],
      ["/api/admin/delivery-partners", "GET"], [`/api/admin/vendors/${vendor}`, "GET"],
      [`/api/admin/customers/${customer}`, "GET"], [`/api/admin/delivery-partners/${partner}`, "GET"],
      [`/api/admin/vendors/${vendor}/status`, "PATCH", { status: "ACTIVE" }],
      [`/api/admin/customers/${customer}/status`, "PATCH", { status: "INACTIVE" }],
      [`/api/admin/delivery-partners/${partner}/status`, "PATCH", { status: "INACTIVE" }],
      ["/api/admin/delivery-partners", "POST", { username: "newqa", password: "Synthetic_qa_A9", displayName: "QA", status: "ACTIVE" }],
    ] as const) await http(actor, path, method, body, 403);
  }
  assert.equal((await pool.query("SELECT count(*)::integer n FROM platform_management_events")).rows[0].n, 0);
});
test("dashboard uses actual counts and vendor searches paginate/filter on server", async () => {
  const summary = (await http(admin, "/api/admin/dashboard")).dashboard;
  assert.equal(summary.totalCustomers, 2); assert.equal(summary.activeCustomers, 2);
  assert.equal(summary.totalVendors, 3); assert.equal(summary.pendingVendors, 1);
  assert.equal(summary.totalDeliveryPartners, 1);
  const page = await http(admin, "/api/admin/vendors?pageSize=1");
  assert.equal(page.items.length, 1); assert.equal(page.total, 3);
  assert.equal((await http(admin, "/api/admin/vendors?search=Neighborhood&status=PENDING_APPROVAL")).total, 1);
  assert.equal((await http(admin, "/api/admin/vendors?search=%25")).total, 0);
  assert.equal((await http(admin, "/api/admin/vendors?page=999")).items.length, 0);
  await http(admin, "/api/admin/vendors?pageSize=1000", "GET", undefined, 400);
  await http(admin, "/api/admin/vendors?status=INACTIVE", "GET", undefined, 400);
});
test("detail views expose management fields only, handle no-store vendors and role mismatch", async () => {
  assert.equal((await http(admin, `/api/admin/vendors/${vendor}`)).account.storeId, store);
  const absent = (await http(admin, `/api/admin/vendors/${noStoreVendor}`)).account;
  assert.equal(absent.status, null); assert.deepEqual(absent.allowedStatuses, []);
  const shopper = (await http(admin, `/api/admin/customers/${customer}`)).account;
  assert.equal(shopper.orderCount, 0); assert.ok(!("addresses" in shopper));
  const courier = (await http(admin, `/api/admin/delivery-partners/${partner}`)).account;
  assert.equal(courier.email, null); assert.equal(courier.username, "qa_partner");
  await http(admin, `/api/admin/customers/${vendor}`, "GET", undefined, 404);
  await http(admin, "/api/admin/customers/not-a-uuid", "GET", undefined, 400);
});
test("approval/rejection/suspension/reactivation use original legal transitions and audit atomically", async () => {
  await http(admin, `/api/admin/vendors/${vendor}/status`, "PATCH", { status: "ACTIVE", role: "admin" }, 400);
  await http(admin, `/api/admin/vendors/${vendor}/status`, "PATCH", { status: "ACTIVE" });
  await http(admin, `/api/admin/vendors/${vendor}/status`, "PATCH", { status: "ACTIVE" }, 409);
  await http(admin, `/api/admin/vendors/${vendor}/status`, "PATCH", { status: "SUSPENDED" });
  await http(vendor, "/api/vendor/products", "GET", undefined, 403);
  await http(vendor, "/api/vendor/orders", "GET", undefined, 403);
  await http(admin, `/api/admin/vendors/${vendor}/status`, "PATCH", { status: "ACTIVE" });
  const thirdVendor = randomUUID();
  await pool.query("INSERT INTO auth.users(id) VALUES($1)", [thirdVendor]);
  await pool.query("UPDATE user_profiles SET role='vendor' WHERE id=$1", [thirdVendor]);
  await pool.query("INSERT INTO stores(owner_user_id,name) VALUES($1,'Reject test')", [thirdVendor]);
  await http(admin, `/api/admin/vendors/${thirdVendor}/status`, "PATCH", { status: "REJECTED" });
  await http(admin, `/api/admin/vendors/${thirdVendor}/status`, "PATCH", { status: "ACTIVE" }, 409);
  const events = (await pool.query("SELECT action,actor_user_id FROM platform_management_events ORDER BY created_at")).rows;
  assert.deepEqual(events.map(e => e.action), ["vendor_approved", "vendor_suspended", "vendor_reactivated", "vendor_rejected"]);
  assert.ok(events.every(e => e.actor_user_id === admin));
});
test("concurrent approval creates one transition/audit event and rejects stale request", async () => {
  const id = randomUUID();
  await pool.query("INSERT INTO auth.users(id) VALUES($1)", [id]);
  await pool.query("UPDATE user_profiles SET role='vendor' WHERE id=$1", [id]);
  const s = (await pool.query("INSERT INTO stores(owner_user_id,name) VALUES($1,'Concurrent QA') RETURNING id", [id])).rows[0].id;
  const requests = await Promise.all([1, 2].map(() => fetch(`${base}/api/admin/vendors/${id}/status`, {
    method: "PATCH", headers: { Authorization: `Bearer qa-${admin}`, "Content-Type": "application/json" }, body: '{"status":"ACTIVE"}',
  })));
  assert.deepEqual(requests.map(r => r.status).sort(), [200, 409]);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM platform_management_events WHERE target_id=$1", [s])).rows[0].n, 1);
});
test("customer deactivate denies already-issued session; reactivation preserves account/address/cart/history", async () => {
  const before = (await pool.query("SELECT id,full_name,phone,created_at FROM customers WHERE id=$1", [customer])).rows[0];
  await http(admin, `/api/admin/customers/${customer}/status`, "PATCH", { status: "INACTIVE" });
  for (const path of ["/api/customer/orders", "/api/customer/cart", "/api/customer/addresses", "/api/auth/me"]) {
    const denied = await http(customer, path, "GET", undefined, 403); assert.equal(denied.code, "CUSTOMER_INACTIVE");
  }
  assert.equal((await http(admin, "/api/admin/customers?status=INACTIVE&search=shopper")).total, 1);
  await http(admin, `/api/admin/customers/${customer}/status`, "PATCH", { status: "ACTIVE" });
  await http(customer, "/api/customer/orders");
  assert.deepEqual((await pool.query("SELECT id,full_name,phone,created_at FROM customers WHERE id=$1", [customer])).rows[0], before);
});
test("existing partner provisioning API reuses service, validates duplicate/invalid username and never leaks password", async () => {
  const input = { username: "new_admin_qa", password: "Synthetic_qa_A9", displayName: "New QA Partner", status: "ACTIVE" };
  const result = await http(admin, "/api/admin/delivery-partners", "POST", input, 201);
  assert.equal(result.partner.username, input.username); assert.equal(result.partner.id, createdPartner);
  assert.ok(!JSON.stringify(result).includes(input.password));
  await http(admin, "/api/admin/delivery-partners", "POST", input, 409);
  await http(admin, "/api/admin/delivery-partners", "POST", { ...input, username: "1bad" }, 400);
  await http(admin, "/api/admin/delivery-partners", "POST", { ...input, username: "another", role: "admin" }, 400);
  assert.equal((await pool.query("SELECT role FROM user_profiles WHERE id=$1", [result.partner.id])).rows[0].role, "delivery_partner");
  assert.equal((await pool.query("SELECT count(*)::integer n FROM platform_management_events WHERE action='partner_created' AND actor_user_id=$1", [admin])).rows[0].n, 1);
});
test("active assignment deactivation requires warning confirmation, preserves duties/history/stock, denies old partner session", async () => {
  await pool.query(`INSERT INTO orders(id,customer_id,store_id,status,total_amount,subtotal,delivery_fee_snapshot,delivery_address_snapshot,delivery_contact_name,delivery_contact_phone)
    VALUES($1,$2,$3,'READY',100,100,0,'{}','QA','9000000000')`, [order, customer, store]);
  const assignment = (await pool.query("INSERT INTO delivery_assignments(order_id,partner_user_id) VALUES($1,$2) RETURNING *", [order, partner])).rows[0];
  const detail = (await http(admin, `/api/admin/delivery-partners/${partner}`)).account;
  assert.equal(detail.activeAssignments, 1);
  const warning = await http(admin, `/api/admin/delivery-partners/${partner}/status`, "PATCH", { status: "INACTIVE" }, 409);
  assert.equal(warning.code, "ACTIVE_ASSIGNMENTS");
  await http(admin, `/api/admin/delivery-partners/${partner}/status`, "PATCH", { status: "INACTIVE", confirmActiveAssignments: true });
  await http(partner, "/api/delivery-partner/dashboard", "GET", undefined, 403);
  await http(null, "/api/delivery-partner/login", "POST", { username: "qa_partner", password: "synthetic" }, 401);
  assert.deepEqual((await pool.query("SELECT * FROM delivery_assignments WHERE id=$1", [assignment.id])).rows[0], assignment);
  assert.equal((await pool.query("SELECT status FROM orders WHERE id=$1", [order])).rows[0].status, "READY");
  assert.ok(!(await http(vendor, "/api/vendor/delivery-partners")).partners.some((p: { id: string }) => p.id === partner));
  await http(admin, `/api/admin/delivery-partners/${partner}/status`, "PATCH", { status: "ACTIVE" });
  assert.ok((await http(vendor, "/api/vendor/delivery-partners")).partners.some((p: { id: string }) => p.id === partner));
  assert.deepEqual((await pool.query("SELECT * FROM delivery_assignments WHERE id=$1", [assignment.id])).rows[0], assignment);
});
test("inactive customer and suspended vendor cannot bypass API with direct RLS; audit reads admin-only", async () => {
  await http(admin, `/api/admin/customers/${customer}/status`, "PATCH", { status: "INACTIVE" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [customer]);
    await client.query("SET LOCAL ROLE authenticated");
    assert.equal((await client.query("SELECT count(*)::integer n FROM customers")).rows[0].n, 0);
    assert.equal((await client.query("SELECT count(*)::integer n FROM platform_management_events")).rows[0].n, 0);
    await client.query("ROLLBACK");
    await http(admin, `/api/admin/vendors/${vendor}/status`, "PATCH", { status: "SUSPENDED" });
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [vendor]);
    await client.query("SET LOCAL ROLE authenticated");
    const identity = (await client.query("SELECT current_app_role() AS role,current_store_id() AS store")).rows[0];
    assert.equal(identity.role, null); assert.equal(identity.store, null);
    await client.query("ROLLBACK");
    await http(admin, `/api/admin/customers/${customer}/status`, "PATCH", { status: "ACTIVE" });
    await http(admin, `/api/admin/vendors/${vendor}/status`, "PATCH", { status: "ACTIVE" });
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [admin]);
    await client.query("SET LOCAL ROLE authenticated");
    assert.ok((await client.query("SELECT count(*)::integer n FROM platform_management_events")).rows[0].n > 0);
    await client.query("ROLLBACK");
  } finally { await client.query("ROLLBACK"); client.release(); }
});