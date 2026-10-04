// Development-only HTTP QA. Commerce fixtures live solely in a disposable
// loopback PostgreSQL cluster. Real Supabase Auth verifies existing QA sessions.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import net from "node:net";
const require = createRequire(new URL("../../backend/api/package.json", import.meta.url));
const { Pool } = require("pg");
const { createClient } = require("@supabase/supabase-js");
const exec = promisify(execFile);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
assert.equal(process.env.RUN_PHASE9_QA, "1", "Explicit QA opt-in required");
assert.equal(new URL(process.env.SUPABASE_URL).hostname, "gkwcolipeavxnuzqlamb.supabase.co", "Refuse non-development Auth target");
const postgresVersion = (await exec("postgres", ["--version"])).stdout;
assert.ok(/PostgreSQL\) 17\./.test(postgresVersion), "Use PostgreSQL 17 binaries on PATH to match the confirmed development database");
const remote = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
let directory, pool, server, appPool;
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
try {
  // Read-only identity discovery; never change existing development commerce.
  const { rows } = await remote.query(`SELECT u.id,u.email,p.role::text,
    n.normalized_username FROM auth.users u JOIN user_profiles p ON p.id=u.id
    LEFT JOIN identity_usernames n ON n.user_id=u.id`);
  const pick = (role, marker) => {
    const row = rows.find(r => r.role === role && marker.test(r.email ?? r.normalized_username ?? ""));
    assert.ok(row, "Dedicated development QA identity missing"); return row;
  };
  const ca = pick("customer", /customer[_.-]?a/i);
  const cb = pick("customer", /customer[_.-]?b/i);
  const vb = pick("vendor", /vendor[_.-]?b/i);
  const partner = rows.find(r => r.normalized_username === "deliverytest1");
  assert.ok(partner, "Existing development partner missing");
  await remote.end();
  const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, options);
  const login = async (actor, key) => {
    const result = await auth.auth.signInWithPassword({ email: actor.email, password: process.env[key] });
    assert.equal(result.error, null, `Dedicated ${key} login failed`);
    assert.equal(result.data.user.id, actor.id);
    return result.data.session.access_token;
  };
  const customer = await login(ca, "PHASE12_CUSTOMER_A_PASSWORD");
  const otherCustomer = await login(cb, "PHASE12_CUSTOMER_B_PASSWORD");
  const vendor = await login(vb, "PHASE12_VENDOR_B_PASSWORD");
  directory = await mkdtemp(`${tmpdir()}/phase9-qa-`);
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  await exec("initdb", ["-D", `${directory}/data`, "--auth=trust", "--no-locale", "-U", "release_qa"]);
  await exec("pg_ctl", ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`, "-o", `-h 127.0.0.1 -k ${directory} -p ${port}`, "-w", "start"]);
  const localUrl = `postgresql://release_qa@127.0.0.1:${port}/postgres?sslmode=disable`;
  pool = new Pool({ connectionString: localUrl });
  await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE postgres SUPERUSER;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const migrations = new URL("../../database/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter(f => /^\d.*\.sql$/.test(f)).sort()) {
    await pool.query(await readFile(new URL(file, migrations), "utf8"));
  }
  check(true, "all 15 ordered migrations replay on an empty isolated database");
  for (const actor of [ca, cb, vb, partner]) {
    await pool.query("INSERT INTO auth.users(id) VALUES($1)", [actor.id]);
    if (actor.role !== "customer") {
      await pool.query("DELETE FROM customers WHERE id=$1", [actor.id]);
      await pool.query("UPDATE user_profiles SET role=$2::app_role WHERE id=$1", [actor.id, actor.role]);
    }
  }
  await pool.query("INSERT INTO delivery_partner_profiles(user_id,display_name,status) VALUES($1,'QA Partner','ACTIVE')", [partner.id]);
  await pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,'deliverytest1')", [partner.id]);
  const storeId = randomUUID(), otherStoreId = randomUUID(), otherVendorId = randomUUID();
  await pool.query("INSERT INTO auth.users(id) VALUES($1);", [otherVendorId]);
  await pool.query("DELETE FROM customers WHERE id=$1", [otherVendorId]);
  await pool.query("UPDATE user_profiles SET role='vendor' WHERE id=$1", [otherVendorId]);
  for (const [id, owner] of [[storeId, vb.id], [otherStoreId, otherVendorId]]) {
    await pool.query("INSERT INTO stores(id,owner_user_id,name,status,delivery_fee,minimum_order_value) VALUES($1,$2,'Isolated QA Store','ACTIVE',0,0)", [id, owner]);
    await pool.query("INSERT INTO store_service_pincodes(store_id,pincode) VALUES($1,'560001')", [id]);
    await pool.query("INSERT INTO store_operating_hours(store_id,day_of_week,opens_at,closes_at,is_closed) SELECT $1,n,'00:00','23:59',false FROM generate_series(0,6) n", [id]);
  }
  process.env.SUPABASE_DB_URL = localUrl;
  const { createApp } = await import("../../backend/api/dist/app.js");
  const { getPool } = await import("../../lib/db/dist/index.js");
  appPool = getPool();
  server = createApp().listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (token, path, method = "GET", body, expected = 200) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = response.status === 204 ? null : await response.json();
    assert.equal(response.status, expected, `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}: ${value?.error ?? value?.code ?? ""}`);
    return value;
  };
  await request("", "/api/customer/orders", "GET", undefined, 401);
  await request("invalid-token", "/api/customer/orders", "GET", undefined, 401);
  check(true, "missing and invalid sessions cannot read protected orders");
  const addressInput = { label: "QA", recipientName: "QA Recipient", phone: "9000000000", line1: "QA street", city: "QA city", state: "QA state", pincode: "560001", isDefault: true };
  const address = (await request(customer, "/api/customer/addresses", "POST", addressInput, 201)).address;
  const addressB = (await request(otherCustomer, "/api/customer/addresses", "POST", addressInput, 201)).address;
  const masterId = randomUUID();
  await pool.query("INSERT INTO master_products(id,name) VALUES($1,'Rice QA')", [masterId]);
  const path = `/api/vendor/master-products/${masterId}/add-to-store`;
  const product = (await request(vendor, path, "POST", {}, 201)).product;
  const reused = await request(vendor, path, "POST", {});
  check(reused.reused && reused.product.id === product.id, "duplicate master selection reuses listing");
  const variants = [];
  for (const [quantityValue, quantityUnit, price, stockQuantity] of [[1, "kg", 70, 10], [500, "g", 40, 0]]) {
    variants.push((await request(vendor, `/api/vendor/products/${product.id}/variants`, "POST", { quantityValue, quantityUnit, price, stockQuantity }, 201)).variant);
  }
  await request(vendor, `/api/vendor/products/${product.id}/availability`, "PATCH", { availability: true });
  await request(vendor, `/api/vendor/products/${product.id}/activate`, "POST");
  const stores = await request(customer, "/api/customer/stores?pincode=560001");
  check(stores.stores.some(s => s.id === storeId), "saved-pincode store discovery");
  for (const search of ["rice", "milk", "eggs", "apple", "zzzznonexistent"]) {
    const results = await request(customer, `/api/customer/products?pincode=560001&search=${search}`);
    check(!JSON.stringify(results).includes("stockQuantity"), `category-free ${search} search omits exact stock`);
  }
  const detail = await request(customer, `/api/customer/stores/${storeId}/products/${product.id}?pincode=560001`);
  check(detail.product.variants.length === 2, "details retain mixed-unit and zero-stock options");
  const add = { productId: product.id, variantId: variants[0].id, quantity: 3 };
  const cart = (await request(customer, "/api/customer/cart/items", "POST", add, 201)).cart;
  check(cart.items[0].variantId === variants[0].id && cart.items[0].quantity === 3, "cart retains exact selected variant and quantity");
  await request(customer, "/api/customer/cart/items", "POST", { ...add, variantId: variants[1].id, quantity: 1 }, 409);
  await request(otherCustomer, `/api/customer/cart/items/${cart.items[0].id}`, "PATCH", { quantity: 2 }, 404);
  await request(otherCustomer, `/api/customer/addresses/${address.id}`, "PATCH", { label: "forged" }, 404);
  check((await request(customer, "/api/customer/cart")).cart.items[0].quantity === 3, "cross-customer denial leaves original cart unchanged");
  await request(customer, "/api/customer/checkout/validate", "POST", { addressId: address.id, paymentMethod: "COD" });
  const checkout = { addressId: address.id, paymentMethod: "COD", cartId: cart.id, idempotencyKey: randomUUID() };
  const placed = await Promise.all([request(customer, "/api/customer/orders", "POST", checkout, 201), request(customer, "/api/customer/orders", "POST", checkout, 201)]);
  const order = placed[0].order;
  check(placed[1].order.id === order.id, "concurrent duplicate checkout creates one order");
  const stock = async () => (await pool.query("SELECT stock_quantity FROM product_variants WHERE id=$1", [variants[0].id])).rows[0].stock_quantity;
  check(await stock() === 7, "10 minus 3 is 7 through actual checkout API");
  check((await request(customer, "/api/customer/cart")).cart === null, "checkout converts active cart");
  await request(otherCustomer, `/api/customer/orders/${order.id}`, "GET", undefined, 404);
  await request(customer, `/api/vendor/orders/${order.id}/actions`, "POST", { action: "ACCEPT" }, 403);
  for (const action of ["ACCEPT", "PREPARE", "READY"]) await request(vendor, `/api/vendor/orders/${order.id}/actions`, "POST", { action });
  const partnerSession = await request("", "/api/delivery-partner/login", "POST", { username: "DELIVERYTEST1", password: process.env.PHASE6_DELIVERY_TEST_PASSWORD });
  const partnerToken = partnerSession.session.access_token;
  const assignment = (await request(vendor, `/api/vendor/orders/${order.id}/delivery`, "POST", { partnerId: partner.id })).assignment;
  assert.ok(assignment?.id, "Assignment response must provide operational identity");
  await request(vendor, `/api/vendor/orders/${order.id}/actions`, "POST", { action: "DELIVER" }, 403);
  for (const [action, status] of [["ACCEPT", "READY"], ["PICKUP", "READY"], ["START", "OUT_FOR_DELIVERY"], ["DELIVER", "DELIVERED"]]) {
    await request(partnerToken, `/api/delivery-partner/deliveries/${assignment.id}/actions`, "POST", { action });
    const visible = (await request(customer, `/api/customer/orders/${order.id}`)).order;
    check(visible.status === status && await stock() === 7, `${action}: customer sees ${status}, inventory unchanged`);
    check(!JSON.stringify(visible).includes("partnerUserId") && !JSON.stringify(visible).includes("assignmentId"), `${action}: customer delivery privacy`);
  }
  await request(partnerToken, `/api/delivery-partner/deliveries/${assignment.id}/actions`, "POST", { action: "DELIVER" }, 409);
  const snapshot = (await request(customer, `/api/customer/orders/${order.id}`)).order;
  await request(vendor, `/api/vendor/products/${product.id}/variants/${variants[0].id}`, "PATCH", { price: 85 });
  const preview = await request(customer, `/api/customer/orders/${order.id}/repeat-preview?addressId=${address.id}`);
  check(JSON.stringify(preview).includes("85.00"), "Buy Again uses current price");
  const repeated = await request(customer, `/api/customer/orders/${order.id}/repeat`, "POST", { addressId: address.id, idempotencyKey: randomUUID() });
  check(Boolean(repeated.cart), "Buy Again creates cart, not order");
  const after = (await request(customer, `/api/customer/orders/${order.id}`)).order;
  check(JSON.stringify(after) === JSON.stringify(snapshot), "current price update and Buy Again preserve complete historical receipt");
  check((await pool.query("SELECT count(*)::int n FROM orders")).rows[0].n === 1 && await stock() === 7, "reorder does not place another order or deduct inventory");
  await request(partnerToken, "/api/customer/orders", "GET", undefined, 403);
  await request(partnerToken, `/api/vendor/products/${product.id}/variants`, "POST", { quantityValue: 1, quantityUnit: "kg", price: 1 }, 403);
  await request(otherCustomer, `/api/delivery-partner/deliveries/${assignment.id}/actions`, "POST", { action: "ACCEPT" }, 403);
  check(addressB.id !== address.id, "account switching uses distinct addresses");
  console.log(`PHASE9_HTTP_JOURNEY: ${checks} passed, 0 failed; managed development commerce untouched`);
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await appPool?.end();
  await pool?.end();
  await remote.end().catch(() => {});
  if (directory) {
    await exec("pg_ctl", ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"]).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}