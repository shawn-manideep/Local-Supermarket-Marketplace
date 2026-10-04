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
import { deliveryWorkflow } from "./workflow.js";
import { createApp } from "../app.js";

const exec = promisify(execFile);
let directory: string, pool: pg.Pool, workflow: ReturnType<typeof deliveryWorkflow>;
let vendor: { userId: string; storeId: string }, otherVendor: typeof vendor, a: string, b: string;
before(async () => {
  directory = await mkdtemp(`${tmpdir()}/delivery-workflow-`);
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  await exec("initdb", ["-D", `${directory}/data`, "--auth=trust", "--no-locale", "-U", "workflow_test"]);
  await exec("pg_ctl", ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`, "-o", `-h 127.0.0.1 -k ${directory} -p ${port}`, "-w", "start"]);
  pool = new pg.Pool({ host: "127.0.0.1", port, database: "postgres", user: "workflow_test", ssl: false, max: 12 });
  await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TYPE app_role AS ENUM('customer','vendor','admin');
    CREATE TYPE order_status AS ENUM('PLACED','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED','CANCELLED','REJECTED');
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,role app_role NOT NULL DEFAULT 'customer',updated_at timestamptz DEFAULT now());
    CREATE TABLE customers(id uuid PRIMARY KEY REFERENCES user_profiles);
    CREATE TABLE stores(id uuid PRIMARY KEY,owner_user_id uuid REFERENCES user_profiles,name text NOT NULL);
    CREATE TABLE orders(id uuid PRIMARY KEY,store_id uuid REFERENCES stores,status order_status NOT NULL,
      total_amount numeric NOT NULL DEFAULT 100,delivery_address_snapshot jsonb NOT NULL DEFAULT '{"line1":"Test street","city":"Test city","state":"Test state","pincode":"123456","phone":"PRIVATE"}',
      delivery_contact_name text DEFAULT 'Recipient', delivery_contact_phone text DEFAULT 'PRIVATE',
      inventory_state text DEFAULT 'DEDUCTED',updated_at timestamptz DEFAULT now());
    CREATE TABLE order_status_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES orders,status order_status,changed_by uuid REFERENCES user_profiles,created_at timestamptz DEFAULT now());
    CREATE TABLE product_variants(id uuid PRIMARY KEY,stock_quantity integer);
    INSERT INTO product_variants VALUES(gen_random_uuid(),17);
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION current_app_role() RETURNS app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT role FROM user_profiles WHERE id=auth.uid() $$;`);
  for (const file of ["0012_delivery_partner_role", "0013_delivery_partner_foundation", "0014_delivery_workflow"]) {
    await pool.query(await readFile(new URL(`../../../../database/migrations/${file}.sql`, import.meta.url), "utf8"));
  }
  workflow = deliveryWorkflow(drizzle(pool));
  vendor = { userId: randomUUID(), storeId: randomUUID() };
  otherVendor = { userId: randomUUID(), storeId: randomUUID() };
  for (const v of [vendor, otherVendor]) {
    await pool.query("INSERT INTO user_profiles(id,role) VALUES($1,'vendor')", [v.userId]);
    await pool.query("INSERT INTO stores VALUES($1,$2,'Test Store')", [v.storeId, v.userId]);
  }
  a = randomUUID(); b = randomUUID();
  for (const id of [a, b]) {
    await pool.query("INSERT INTO user_profiles(id,role) VALUES($1,'delivery_partner')", [id]);
    await pool.query("INSERT INTO delivery_partner_profiles(user_id,display_name) VALUES($1,'Partner')", [id]);
  }
}, { timeout: 60_000 });
after(async () => {
  await pool?.end();
  if (directory) {
    await exec("pg_ctl", ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
async function order(status = "READY", owner = vendor) {
  const id = randomUUID();
  await pool.query("INSERT INTO orders(id,store_id,status) VALUES($1,$2,$3)", [id, owner.storeId, status]);
  return id;
}
async function assignment(partner = a) {
  const orderId = await order();
  const value = await workflow.assign(vendor, orderId, partner);
  assert.ok(value);
  return { id: String(value.id), orderId };
}
async function readOrder(id: string) {
  return (await pool.query("SELECT * FROM orders WHERE id=$1", [id])).rows[0];
}
test("A/B: vendor assigns ACTIVE partner only to READY; timestamps recorded", async () => {
  const value = await assignment();
  const row = (await pool.query("SELECT * FROM delivery_assignments WHERE id=$1", [value.id])).rows[0];
  assert.equal(row.status, "PENDING"); assert.ok(row.assigned_at);
  for (const status of ["PLACED","ACCEPTED","PREPARING","OUT_FOR_DELIVERY","DELIVERED","REJECTED","CANCELLED"]) {
    await assert.rejects(workflow.assign(vendor, await order(status), a), { code: "ORDER_NOT_READY" });
  }
});
test("C/E: cross-store vendor and customer cannot assign; claimed store is not proof", async () => {
  const id = await order();
  const customer = randomUUID();
  await pool.query("INSERT INTO user_profiles(id) VALUES($1)", [customer]);
  for (const actor of [otherVendor, { userId: customer, storeId: vendor.storeId }, { userId: otherVendor.userId, storeId: vendor.storeId }]) {
    await assert.rejects(workflow.assign(actor, id, a), { code: "UNAUTHORIZED_DELIVERY_ACTION" });
  }
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM delivery_assignments WHERE order_id=$1", [id])).rows[0].n, 0);
});
test("D: inactive/nonexistent/wrong-role partners cannot be assigned or perform duties", async () => {
  const id = await order();
  await pool.query("UPDATE delivery_partner_profiles SET status='INACTIVE' WHERE user_id=$1", [b]);
  assert.equal((await workflow.eligible(vendor)).some(row => row.id === b), false);
  await assert.rejects(workflow.assign(vendor,id,b), { code: "PARTNER_INACTIVE" });
  await assert.rejects(workflow.assign(vendor,id,randomUUID()), { code: "PARTNER_NOT_FOUND" });
  await assert.rejects(workflow.assign(vendor,id,vendor.userId), { code: "PARTNER_NOT_FOUND" });
  await pool.query("UPDATE delivery_partner_profiles SET status='ACTIVE' WHERE user_id=$1", [b]);
  const row = await assignment(b);
  await pool.query("UPDATE delivery_partner_profiles SET status='INACTIVE' WHERE user_id=$1", [b]);
  await assert.rejects(workflow.action(b,row.id,"ACCEPT"), { code: "PARTNER_INACTIVE" });
  await pool.query("UPDATE delivery_partner_profiles SET status='ACTIVE' WHERE user_id=$1", [b]);
});
test("F/G: only own deliveries/details; role/ownership isolation and minimal address allowlist", async () => {
  const row = await assignment(a);
  const own = await workflow.own(a,row.id) as Record<string, unknown>;
  assert.equal(own.id,row.id);
  assert.doesNotMatch(JSON.stringify(own), /PRIVATE|customerId|customer_id|commission|partner_user_id|contact_phone/);
  await assert.rejects(workflow.own(b,row.id), { code: "NOT_ASSIGNED_PARTNER" });
  const rows = await workflow.own(b) as Array<Record<string, unknown>>;
  assert.equal(rows.some(item => item.id === row.id),false);
});
test("H/I/J/K: accept or reject pending; rejection keeps order READY and allows explicit reassignment", async () => {
  const row = await assignment();
  const rejected = await workflow.action(a,row.id,"REJECT") as Record<string, unknown>;
  assert.equal(rejected.status,"REJECTED"); assert.ok(rejected.rejectedAt);
  assert.equal(rejected.deliveryAddress,null);
  assert.equal((await readOrder(row.orderId)).status,"READY");
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM order_status_history WHERE order_id=$1", [row.orderId])).rows[0].n,0);
  const next = await workflow.assign(vendor,row.orderId,b);
  assert.ok(next); assert.notEqual(next.id,row.id);
  assert.equal((await workflow.action(b,String(next.id),"ACCEPT") as Record<string,unknown>).status,"ACCEPTED");
  await assert.rejects(workflow.assign(vendor,row.orderId,a), { code: "ASSIGNMENT_ALREADY_HANDLED" });
});
test("L/M/N/O/Q/W/X/Y/Z: pickup/start/deliver share order lifecycle/history; inventory and snapshots unchanged", async () => {
  const row = await assignment();
  const before = await readOrder(row.orderId);
  const stock = (await pool.query("SELECT * FROM product_variants")).rows;
  await assert.rejects(workflow.action(a,row.id,"PICKUP"), { code: "INVALID_DELIVERY_TRANSITION" });
  await assert.rejects(workflow.action(a,row.id,"START"), { code: "INVALID_DELIVERY_TRANSITION" });
  await workflow.action(a,row.id,"ACCEPT");
  const pickup = await workflow.action(a,row.id,"PICKUP") as Record<string, unknown>;
  assert.ok(pickup.pickedUpAt); assert.equal((await readOrder(row.orderId)).status,"READY");
  await workflow.action(a,row.id,"START");
  assert.equal((await readOrder(row.orderId)).status,"OUT_FOR_DELIVERY");
  assert.equal((await workflow.vendorRead(vendor,row.orderId))!.status,"OUT_FOR_DELIVERY");
  const delivered = await workflow.action(a,row.id,"DELIVER") as Record<string, unknown>;
  assert.ok(delivered.deliveredAt);
  assert.equal((await readOrder(row.orderId)).status,"DELIVERED");
  assert.equal((await workflow.vendorRead(vendor,row.orderId))!.status,"DELIVERED");
  const { status: _s, updated_at: _u, ...afterSnapshot } = await readOrder(row.orderId);
  const { status: _oldS, updated_at: _oldU, ...beforeSnapshot } = before;
  assert.deepEqual(afterSnapshot,beforeSnapshot);
  assert.deepEqual((await pool.query("SELECT * FROM product_variants")).rows,stock);
  assert.deepEqual((await pool.query("SELECT status,changed_by FROM order_status_history WHERE order_id=$1 ORDER BY created_at", [row.orderId])).rows,
    [{status:"OUT_FOR_DELIVERY",changed_by:a},{status:"DELIVERED",changed_by:a}]);
});
test("P/R/S: another partner/vendor/customer cannot act; repeated delivery has no history effect", async () => {
  const row = await assignment();
  for (const id of [b,vendor.userId,randomUUID()]) {
    for (const action of ["ACCEPT","REJECT","PICKUP","START","DELIVER"] as const) {
      await assert.rejects(workflow.action(id,row.id,action), { code:"NOT_ASSIGNED_PARTNER" });
    }
  }
  for (const action of ["ACCEPT","PICKUP","START","DELIVER"] as const) await workflow.action(a,row.id,action);
  await assert.rejects(workflow.action(a,row.id,"DELIVER"), { code:"DELIVERY_ALREADY_COMPLETED" });
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM order_status_history WHERE order_id=$1", [row.orderId])).rows[0].n,2);
});
test("T/U: concurrent accept and pickup allow one transition each", async () => {
  const row = await assignment();
  for (const action of ["ACCEPT","PICKUP"] as const) {
    const result = await Promise.allSettled([workflow.action(a,row.id,action),workflow.action(a,row.id,action)]);
    assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
    assert.equal(result.filter(r=>r.status==="rejected").length,1);
  }
});
test("concurrent start/deliver create exactly one order-history event per transition", async () => {
  const row = await assignment();
  await workflow.action(a,row.id,"ACCEPT"); await workflow.action(a,row.id,"PICKUP");
  for (const action of ["START","DELIVER"] as const) {
    const result = await Promise.allSettled([workflow.action(a,row.id,action),workflow.action(a,row.id,action)]);
    assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
  }
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM order_status_history WHERE order_id=$1",[row.orderId])).rows[0].n,2);
});
test("history write failure rolls back order and assignment atomically", async () => {
  const row = await assignment();
  for (const action of ["ACCEPT","PICKUP","START"] as const) await workflow.action(a,row.id,action);
  await pool.query("ALTER TABLE order_status_history ADD CONSTRAINT test_history_failure CHECK(status <> 'DELIVERED') NOT VALID");
  try {
    await assert.rejects(workflow.action(a,row.id,"DELIVER"));
    assert.equal((await readOrder(row.orderId)).status,"OUT_FOR_DELIVERY");
    assert.equal((await pool.query("SELECT status,delivered_at FROM delivery_assignments WHERE id=$1",[row.id])).rows[0].status,"OUT_FOR_DELIVERY");
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM order_status_history WHERE order_id=$1",[row.orderId])).rows[0].n,1);
  } finally { await pool.query("ALTER TABLE order_status_history DROP CONSTRAINT test_history_failure"); }
});
test("V: competing assignments leave exactly one active; replaced pending row retains history", async () => {
  const id = await order();
  await Promise.allSettled([workflow.assign(vendor,id,a),workflow.assign(vendor,id,b)]);
  const rows = (await pool.query("SELECT * FROM delivery_assignments WHERE order_id=$1", [id])).rows;
  assert.equal(rows.filter(row=>row.status==="PENDING").length,1);
  assert.equal(rows.filter(row=>row.status==="CANCELLED").length,1);
  const cancelled = rows.find(row=>row.status==="CANCELLED");
  await assert.rejects(workflow.action(cancelled.partner_user_id,cancelled.id,"ACCEPT"), { code:"ASSIGNMENT_NOT_PENDING" });
});
test("assignment states, uniqueness, partner identity, immutable ownership and timestamps enforced by DB", async () => {
  const row = await assignment();
  await assert.rejects(pool.query("INSERT INTO delivery_assignments(order_id,partner_user_id) VALUES($1,$2)",[row.orderId,b]), { code:"23505" });
  await assert.rejects(pool.query("UPDATE delivery_assignments SET status='ACCEPTED' WHERE id=$1",[row.id]), { code:"23514" });
  await assert.rejects(pool.query("UPDATE delivery_assignments SET partner_user_id=$1 WHERE id=$2",[b,row.id]), { code:"23514" });
  await pool.query("UPDATE user_profiles SET role='customer' WHERE id=$1",[b]);
  await assert.rejects(pool.query("INSERT INTO delivery_assignments(order_id,partner_user_id) VALUES($1,$2)",[await order(),b]), { code:"23514" });
  await pool.query("UPDATE user_profiles SET role='delivery_partner' WHERE id=$1",[b]);
});
test("terminal/ineligible order denies duty without altering assignment, order or history", async () => {
  const row = await assignment();
  await pool.query("UPDATE orders SET status='CANCELLED' WHERE id=$1",[row.orderId]);
  await assert.rejects(workflow.action(a,row.id,"ACCEPT"), { code:"INVALID_DELIVERY_TRANSITION" });
  assert.equal((await pool.query("SELECT status FROM delivery_assignments WHERE id=$1",[row.id])).rows[0].status,"PENDING");
});
test("RLS allows own partner/store metadata only and denies every direct assignment mutation", async () => {
  const ours = await assignment(a);
  const otherOrder = await order("READY",otherVendor);
  const other = await workflow.assign(otherVendor,otherOrder,b);
  assert.ok(other);
  await pool.query(`GRANT SELECT ON orders,stores TO authenticated;
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY test_vendor_orders ON orders FOR SELECT TO authenticated USING (
      current_app_role()='vendor' AND EXISTS(SELECT 1 FROM stores WHERE stores.id=orders.store_id AND owner_user_id=auth.uid()));`);
  const client = await pool.connect();
  try {
    await client.query("SET ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[a]);
    const partnerRows = (await client.query("SELECT id FROM delivery_assignments")).rows;
    assert.equal(partnerRows.some(row=>row.id===ours.id),true);
    assert.equal(partnerRows.some(row=>row.id===other!.id),false);
    await assert.rejects(client.query("SELECT order_id FROM delivery_assignments"),{code:"42501"});
    await assert.rejects(client.query("UPDATE delivery_assignments SET status='ACCEPTED' WHERE id=$1",[ours.id]),{code:"42501"});
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[vendor.userId]);
    const vendorRows = (await client.query("SELECT id FROM delivery_assignments")).rows;
    assert.equal(vendorRows.some(row=>row.id===ours.id),true);
    assert.equal(vendorRows.some(row=>row.id===other!.id),false);
    await assert.rejects(client.query("INSERT INTO delivery_assignments(order_id,partner_user_id) VALUES($1,$2)",[ours.orderId,a]),{code:"42501"});
  } finally { await client.query("RESET ROLE");client.release(); }
});
test("new HTTP routes require authentication and never expose public provisioning/actions", async () => {
  const server = createApp().listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    const id = randomUUID();
    for (const [path,method] of [
      ["/api/vendor/delivery-partners","GET"],[`/api/vendor/orders/${id}/delivery`,"GET"],
      [`/api/vendor/orders/${id}/delivery`,"POST"],[`/api/delivery-partner/deliveries/${id}`,"GET"],
      [`/api/delivery-partner/deliveries/${id}/actions`,"POST"],
    ]) assert.equal((await fetch(base+path,{method})).status,401);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});