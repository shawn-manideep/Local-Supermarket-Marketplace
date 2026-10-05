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
const postgres = process.env.ADMIN_QA_POSTGRES_BIN ?? "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";
let directory: string, pool: pg.Pool, server: Server, base: string, vendorA: string, vendorB: string;
let failActivation = false, requestNumber = 0, createdIdentities = 0;
const originalFetch = globalThis.fetch;
const admin = randomUUID(), customer = randomUUID(), existingVendor = randomUUID(), partner = randomUUID();
const existingStore = randomUUID(), product = randomUUID(), variant = randomUUID(), order = randomUUID();
const users = new Map<string, { email: string; password: string; banned: boolean }>();
const actors = new Map<string, string>();
const creation = {
  username: "Location_A", password: "Synthetic_QA_A9", name: "Sri Lakshmi Supermarket", ownerName: "QA Owner A",
  phone: "9876543210", email: "owner_a@qa.invalid", description: "Neighborhood groceries",
  logoImageUrl: "https://example.invalid/logo.png", addressLine1: "Plot No. 12, Main Road", addressLine2: "Near Community Hall",
  locality: "Pragathi Nagar", city: "Hyderabad", state: "Telangana", pincode: "500090",
  deliveryFee: 15, minimumOrderValue: 100,
  hours: [{ dayOfWeek: 1, isClosed: false, opensAt: "09:00", closesAt: "21:00" }],
};
before(async () => {
  directory = await mkdtemp(`${tmpdir()}/vendor-profile-`);
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  await exec(`${postgres}/initdb`, ["-D", `${directory}/data`, "--auth=trust", "--no-locale", "-U", "vendor_qa"]);
  await exec(`${postgres}/pg_ctl`, ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`, "-o", `-h 127.0.0.1 -k ${directory} -p ${port}`, "-w", "start"]);
  pool = new pg.Pool({ host: "127.0.0.1", port, database: "postgres", user: "vendor_qa", ssl: false });
  await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE postgres SUPERUSER;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const migrations = new URL("../../../../database/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter(f => /^\d.*\.sql$/.test(f)).sort()) {
    await pool.query(await readFile(new URL(file, migrations), "utf8"));
  }
  for (const [id, role] of [[admin, "admin"], [customer, "customer"], [existingVendor, "vendor"], [partner, "delivery_partner"]]) {
    await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, `${role}@qa.invalid`]);
    await pool.query("UPDATE user_profiles SET role=$2::app_role WHERE id=$1", [id, role]);
    if (role !== "customer") await pool.query("DELETE FROM customers WHERE id=$1", [id]);
    actors.set(`qa-${id}`, id!);
  }
  await pool.query("INSERT INTO stores(id,owner_user_id,name,status) VALUES($1,$2,'Existing operational store','ACTIVE')", [existingStore, existingVendor]);
  await pool.query(`INSERT INTO customer_addresses(customer_id,recipient_name,phone,line1,city,state,pincode,is_default)
    VALUES($1,'QA Shopper','9876543210','QA Home','Hyderabad','Telangana','500090',true)`, [customer]);
  await pool.query("INSERT INTO delivery_partner_profiles(user_id,display_name) VALUES($1,'QA Partner')", [partner]);
  await pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,'existing_partner')", [partner]);
  await pool.query("INSERT INTO products(id,store_id,name,price,stock_quantity,availability) VALUES($1,$2,'Protected groceries',50,17,true)", [product, existingStore]);
  await pool.query(`INSERT INTO product_variants(id,product_id,name,quantity_value,quantity_unit,price,stock_quantity,availability,sku,external_code)
    VALUES($1,$2,'One kilogram',1,'kg',50,17,true,'PROTECTED-SKU','PROTECTED-EXT')`, [variant, product]);
  await pool.query(`INSERT INTO orders(id,customer_id,store_id,status,total_amount,subtotal,delivery_fee_snapshot,delivery_address_snapshot,delivery_contact_name,delivery_contact_phone)
    VALUES($1,$2,$3,'READY',100,100,0,'{"addressLine1":"Original historical address"}','QA','9876543210')`, [order, customer, existingStore]);
  await pool.query(`INSERT INTO order_items(order_id,product_id,variant_id,product_name_snapshot,variant_name_snapshot,variant_quantity_value_snapshot,
    variant_quantity_unit_snapshot,product_price_snapshot,quantity,subtotal) VALUES($1,$2,$3,'Original product','Original pack',1,'kg',50,2,100)`, [order, product, variant]);
  await pool.query("INSERT INTO order_status_history(order_id,status,note,changed_by) VALUES($1,'READY','Original history',$2)", [order, existingVendor]);
  await pool.query("INSERT INTO delivery_assignments(order_id,partner_user_id) VALUES($1,$2)", [order, partner]);
  process.env.SUPABASE_URL = "https://vendor-profile-qa.example.invalid";
  process.env.SUPABASE_ANON_KEY = "synthetic-test-publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-service-key";
  // Only the external identity provider is simulated. HTTP routes, validation,
  // all migrations, transactions, constraints, RLS, auditing and reads are real.
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${process.env.SUPABASE_URL}/auth/v1/`)) return originalFetch(input, init);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : {};
    const method = init?.method ?? "GET";
    const id = url.split("/").pop()!;
    if (url.endsWith("/admin/users") && method === "POST") {
      if ([...users.values()].some(user => user.email === body.email)) return Response.json({ code: "email_exists", message: "Email exists" }, {
        status: 422, headers: { "X-Supabase-Api-Version": "2024-01-01" },
      });
      const createdId = randomUUID(); createdIdentities++;
      users.set(createdId, { email: body.email, password: body.password, banned: true });
      await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [createdId, body.email]);
      return Response.json({ id: createdId, email: body.email });
    }
    if (url.includes("/admin/users/")) {
      if (method === "DELETE") {
        users.delete(id);
        await pool.query("DELETE FROM auth.users WHERE id=$1", [id]);
        return Response.json({});
      }
      const user = users.get(id);
      if (!user) return Response.json({ message: "Missing identity" }, { status: 404 });
      if (method === "PUT") {
        if (failActivation) return Response.json({ message: "Synthetic activation failure" }, { status: 503 });
        user.banned = body.ban_duration !== "none";
      }
      return Response.json({ id, email: user.email });
    }
    if (url.includes("/token?")) {
      const entry = [...users].find(([, user]) => user.email === body.email && user.password === body.password && !user.banned);
      if (!entry) return Response.json({ message: "Invalid credentials" }, { status: 400 });
      const access = `qa-${entry[0]}`; actors.set(access, entry[0]);
      return Response.json({ access_token: access, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user: { id: entry[0], email: entry[1].email } });
    }
    if (url.endsWith("/user")) {
      const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
      const actor = actors.get(token ?? "");
      if (actor) return Response.json({ id: actor, email: `${actor}@qa.invalid`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
    }
    return Response.json({ message: "Invalid credentials" }, { status: 401 });
  };
  process.env.SUPABASE_DB_URL = `postgresql://vendor_qa@127.0.0.1:${port}/postgres?sslmode=disable`;
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
}, { timeout: 60000 });
after(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (pool) {
    const { getPool } = await import("@workspace/db");
    await getPool().end(); await pool.end();
  }
  if (directory) {
    await exec(`${postgres}/pg_ctl`, ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"]).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
type StoreData = Record<string, string | null>;
type Payload = {
  error?: string; code?: string;
  account: { id: string; username: string; storeId: string; status: string; ownerName: string; city: string; store: StoreData; hours: Array<{ opensAt: string; closesAt: string }> };
  store: StoreData;
  items: Array<{ id: string; username: string; ownerName: string; city: string; locality: string; pincode: string }>;
  total: number; auth: { role: string; userId: string; storeId: string };
  session: { access_token: string; refresh_token: string };
};
async function http(actor: string | null, path: string, method = "GET", body?: unknown, expected = 200) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", "X-Forwarded-For": `192.0.2.${++requestNumber}`,
      ...(actor ? { Authorization: `Bearer qa-${actor}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json() as Payload;
  assert.equal(response.status, expected, `${method} ${path}: ${result.error ?? ""}`);
  assert.ok(!JSON.stringify(result).includes(creation.password), "password must never be returned");
  if (path.startsWith("/api/admin/")) assert.equal(response.headers.get("cache-control"), "no-store");
  return result;
}
async function counts() {
  return (await pool.query(`SELECT (SELECT count(*)::integer FROM auth.users) AS identities,
    (SELECT count(*)::integer FROM user_profiles) AS profiles,(SELECT count(*)::integer FROM stores) AS stores,
    (SELECT count(*)::integer FROM identity_usernames) AS usernames,(SELECT count(*)::integer FROM platform_management_events) AS audit`)).rows[0];
}
async function protectedData() {
  const tables = ["products", "product_variants", "orders", "order_items", "order_status_history", "delivery_assignments", "master_products", "master_categories"];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows])));
}
test("all non-admin roles and missing sessions denied create/update/read with zero writes", async () => {
  const baseline = await counts();
  for (const actor of [null, customer, existingVendor, partner]) {
    const expected = actor ? 403 : 401;
    await http(actor, "/api/admin/vendors", "POST", creation, expected);
    await http(actor, `/api/admin/vendors/${existingVendor}`, "PATCH", { city: "Other city" }, expected);
    await http(actor, `/api/admin/vendors/${existingVendor}`, "GET", undefined, expected);
  }
  assert.deepEqual(await counts(), baseline);
});
test("invalid required fields, username, password, pincode and status fail before Auth identity creation", async () => {
  const baseline = await counts();
  const authBefore = createdIdentities;
  for (const body of [
    { ...creation, ownerName: "" }, { ...creation, addressLine1: "" }, { ...creation, pincode: "050090" },
    { ...creation, username: "admin" }, { ...creation, username: "1bad" }, { ...creation, password: "short" },
    { ...creation, status: "ACTIVE" }, { ...creation, role: "admin" }, { ...creation, email: "bad" },
  ]) await http(admin, "/api/admin/vendors", "POST", body, 400);
  assert.equal(createdIdentities, authBefore);
  assert.deepEqual(await counts(), baseline);
});
test("Admin creates complete Vendor A pending approval, persists every location field and returns no credentials", async () => {
  const protectedBefore = await protectedData();
  const result = await http(admin, "/api/admin/vendors", "POST", creation, 201);
  vendorA = result.account.id;
  assert.equal(result.account.username, "location_a");
  assert.equal(result.account.status, "PENDING_APPROVAL");
  for (const field of ["name", "ownerName", "phone", "email", "description", "logoImageUrl", "addressLine1", "addressLine2", "locality", "city", "state", "pincode"] as const) {
    assert.equal(result.account.store[field], creation[field]);
  }
  assert.equal(result.account.store.deliveryFee, "15.00");
  assert.equal(result.account.store.minimumOrderValue, "100.00");
  assert.equal(result.account.hours[0].opensAt, "09:00:00");
  assert.equal((await pool.query("SELECT count(*)::integer n FROM customers WHERE id=$1", [vendorA])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM products WHERE store_id=$1", [result.account.storeId])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM platform_management_events WHERE action='vendor_created' AND actor_user_id=$1", [admin])).rows[0].n, 1);
  assert.deepEqual(await protectedData(), protectedBefore);
});
test("Vendor B has a separate identity/store/address; creation does not copy or create listings", async () => {
  const result = await http(admin, "/api/admin/vendors", "POST", {
    ...creation, username: "Location_B", email: "owner_b@qa.invalid", name: "QA Store B", ownerName: "QA Owner B",
    locality: "Miyapur", city: "Hyderabad", pincode: "500049", addressLine2: null, hours: [],
  }, 201);
  vendorB = result.account.id;
  actors.set(`qa-${vendorB}`, vendorB);
  assert.notEqual(vendorA, vendorB);
  const a = (await http(admin, `/api/admin/vendors/${vendorA}`)).account;
  assert.notEqual(a.storeId, result.account.storeId);
  assert.equal(a.store.locality, "Pragathi Nagar");
  assert.equal(result.account.store.locality, "Miyapur");
  const listings = await pool.query("SELECT count(*)::integer n FROM products WHERE store_id=ANY($1::uuid[])", [[a.storeId, result.account.storeId]]);
  assert.equal(listings.rows[0].n, 0);
});
test("case-insensitive duplicate username and partner-owned username are globally reserved without writes", async () => {
  const baseline = await counts();
  await http(admin, "/api/admin/vendors", "POST", { ...creation, username: "LOCATION_A", email: "other@qa.invalid" }, 409);
  await http(admin, "/api/admin/vendors", "POST", { ...creation, username: "EXISTING_PARTNER", email: "other@qa.invalid" }, 409);
  assert.deepEqual(await counts(), baseline);
});
test("duplicate Auth email cannot convert existing role, duplicate a store or reserve a username", async () => {
  const baseline = await counts();
  await http(admin, "/api/admin/vendors", "POST", { ...creation, username: "New_Email_QA" }, 409);
  assert.deepEqual(await counts(), baseline);
});
test("concurrent duplicate provisioning commits exactly one account and store", async () => {
  const authBefore = createdIdentities;
  const responses = await Promise.all([1, 2].map(() => fetch(`${base}/api/admin/vendors`, {
    method: "POST", headers: { Authorization: `Bearer qa-${admin}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...creation, username: "Concurrent_QA", email: null }),
  })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal(createdIdentities, authBefore + 1);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM identity_usernames WHERE normalized_username='concurrent_qa'")).rows[0].n, 1);
});
test("activation failure compensates identity, store, hours, username and audit with no partial account", async () => {
  const baseline = await counts();
  failActivation = true;
  try { await http(admin, "/api/admin/vendors", "POST", { ...creation, username: "Fail_Activation_QA", email: null }, 502); }
  finally { failActivation = false; }
  assert.deepEqual(await counts(), baseline);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM identity_usernames WHERE normalized_username='fail_activation_qa'")).rows[0].n, 0);
});
test("database failure during creation rolls back store/identity/username before account activation", async () => {
  const baseline = await counts();
  await pool.query(`CREATE FUNCTION fail_vendor_creation_qa() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.name='Fail store QA' THEN RAISE EXCEPTION 'Synthetic store failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_vendor_creation_qa BEFORE INSERT ON stores FOR EACH ROW EXECUTE FUNCTION fail_vendor_creation_qa()`);
  try { await http(admin, "/api/admin/vendors", "POST", { ...creation, username: "Fail_Database_QA", name: "Fail store QA", email: null }, 500); }
  finally { await pool.query("DROP TRIGGER fail_vendor_creation_qa ON stores; DROP FUNCTION fail_vendor_creation_qa()"); }
  assert.deepEqual(await counts(), baseline);
});
test("new Vendor username login uses existing Supabase session and resolves role/store; wrong-role and wrong-password denied", async () => {
  const result = await http(null, "/api/vendor/login", "POST", { username: "LOCATION_A", password: creation.password });
  assert.equal(result.session.access_token, `qa-${vendorA}`);
  assert.equal((await http(vendorA, "/api/auth/me")).auth.role, "vendor");
  assert.equal((await http(vendorA, "/api/vendor/store")).store.locality, "Pragathi Nagar");
  await http(null, "/api/vendor/login", "POST", { username: "location_a", password: "wrong" }, 401);
  await http(null, "/api/vendor/login", "POST", { username: "existing_partner", password: creation.password }, 401);
});
test("Admin detail/list/search return owner, username and physical location without internal Auth data", async () => {
  const page = await http(admin, "/api/admin/vendors?search=Pragathi");
  assert.equal(page.total, 2, "concurrency fixture has the same locality");
  const row = page.items.find(item => item.id === vendorA)!;
  assert.equal(row.id, vendorA); assert.equal(row.ownerName, "QA Owner A"); assert.equal(row.pincode, "500090");
  assert.equal(row.city, "Hyderabad"); assert.equal(row.username, "location_a");
  await http(admin, `/api/admin/vendors/${customer}`, "GET", undefined, 404);
});
test("Admin profile/weekly hours edits preserve store identity, Auth identity, products, stock, variants, history and delivery", async () => {
  const protectedBefore = await protectedData();
  const authBefore = (await pool.query("SELECT * FROM auth.users ORDER BY id")).rows;
  const original = (await http(admin, `/api/admin/vendors/${existingVendor}`)).account;
  const updated = await http(admin, `/api/admin/vendors/${existingVendor}`, "PATCH", {
    name: "Updated existing shop", ownerName: "Updated owner", phone: "9876543210", email: "contact@qa.invalid",
    addressLine1: "New physical store address", addressLine2: null, locality: "Kukatpally", city: "Hyderabad",
    state: "Telangana", pincode: "500072", deliveryFee: 12, minimumOrderValue: 75,
    hours: [{ dayOfWeek: 2, isClosed: false, opensAt: "08:00", closesAt: "20:00" }],
  });
  assert.equal(updated.account.storeId, original.storeId);
  assert.equal(updated.account.store.status, "ACTIVE");
  assert.equal(updated.account.store.email, "contact@qa.invalid");
  assert.equal(updated.account.hours[0].opensAt, "08:00:00");
  assert.deepEqual((await pool.query("SELECT * FROM auth.users ORDER BY id")).rows, authBefore);
  assert.deepEqual(await protectedData(), protectedBefore);
  assert.equal((await http(existingVendor, "/api/vendor/store")).store.addressLine1, "New physical store address");
});
test("Vendor A may edit its own location only; Vendor B stays unchanged and identity/commercial injections are rejected", async () => {
  const bBefore = (await http(vendorB, "/api/vendor/store")).store;
  const protectedBefore = await protectedData();
  await http(vendorA, "/api/vendor/store", "PATCH", { locality: "Updated A Locality", addressLine2: null });
  assert.equal((await http(vendorA, "/api/vendor/store")).store.locality, "Updated A Locality");
  assert.deepEqual((await http(vendorB, "/api/vendor/store")).store, bBefore);
  for (const field of ["storeId", "username", "password", "status", "price", "stock", "variants", "ownerUserId"]) {
    await http(admin, `/api/admin/vendors/${vendorA}`, "PATCH", { city: "Other", [field]: vendorB }, 400);
    await http(vendorA, "/api/vendor/store", "PATCH", { city: "Other", [field]: vendorB }, 400);
  }
  await http(admin, `/api/admin/vendors/${vendorA}`, "PATCH", { pincode: "000000" }, 400);
  assert.deepEqual(await protectedData(), protectedBefore);
});
test("profile and hour write failure rolls back both store changes and audit atomically", async () => {
  const before = (await http(admin, `/api/admin/vendors/${vendorA}`)).account;
  const baseline = await counts();
  await pool.query(`CREATE FUNCTION fail_vendor_hours_qa() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Synthetic hours failure'; END $$;
    CREATE TRIGGER fail_vendor_hours_qa BEFORE INSERT ON store_operating_hours FOR EACH ROW EXECUTE FUNCTION fail_vendor_hours_qa()`);
  try {
    await http(admin, `/api/admin/vendors/${vendorA}`, "PATCH", { city: "Rolled back city", hours: [{ dayOfWeek: 3, isClosed: true }] }, 500);
  } finally { await pool.query("DROP TRIGGER fail_vendor_hours_qa ON store_operating_hours; DROP FUNCTION fail_vendor_hours_qa()"); }
  const after = (await http(admin, `/api/admin/vendors/${vendorA}`)).account;
  assert.deepEqual(after.store, before.store);
  assert.deepEqual(after.hours, before.hours);
  assert.deepEqual(await counts(), baseline);
});
test("existing status approval/suspension stays separate; suspended vendors are denied old and newly issued sessions", async () => {
  await http(admin, `/api/admin/vendors/${vendorA}/status`, "PATCH", { status: "ACTIVE" });
  await http(admin, `/api/admin/vendors/${vendorA}/status`, "PATCH", { status: "SUSPENDED" });
  await http(vendorA, "/api/vendor/store", "GET", undefined, 403);
  await http(null, "/api/vendor/login", "POST", { username: "location_a", password: creation.password }, 403);
  await http(admin, `/api/admin/vendors/${vendorA}/status`, "PATCH", { status: "ACTIVE" });
  await http(vendorA, "/api/vendor/store");
});
test("customer store projection includes location only and does not alter delivery-area eligibility", async () => {
  await pool.query("INSERT INTO store_service_pincodes(store_id,pincode) VALUES($1,'500090')", [existingStore]);
  const response = await http(customer, `/api/customer/stores/${existingStore}?pincode=500090`);
  assert.equal(response.store.locality, "Kukatpally");
  assert.equal(response.store.pincode, "500072", "physical store address is not its service pincode");
  for (const key of ["ownerUserId", "ownerName", "email", "username"]) assert.ok(!(key in response.store));
  await http(customer, `/api/customer/stores/${existingStore}?pincode=500049`, "GET", undefined, 404);
});
test("direct authenticated store writes remain prohibited", async () => {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SET LOCAL ROLE authenticated");
    await connection.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [vendorB]);
    await assert.rejects(() => connection.query("UPDATE stores SET city='Unauthorized'"));
  } finally { await connection.query("ROLLBACK"); connection.release(); }
});
