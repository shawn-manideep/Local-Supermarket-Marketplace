import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { customerOrderCreateSchema } from "@workspace/validation";
import { checkoutReplay, deductStock, restoreOrderStock, type InventoryLine } from "./inventory.js";

// A disposable local PostgreSQL cluster, not Supabase, development fixtures,
// or production. Missing binaries fail explicitly; these tests never silently skip.
const exec = promisify(execFile);
let directory: string;
let pool: pg.Pool;
let db: ReturnType<typeof drizzle>;
before(async () => {
  directory = await mkdtemp(`${tmpdir()}/marketplace-stock-`);
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  await exec("initdb", ["-D", `${directory}/data`, "--auth=trust", "--no-locale", "-U", "stock_test"]);
  await exec("pg_ctl", ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`, "-o", `-h 127.0.0.1 -k ${directory} -p ${port}`, "-w", "start"]);
  pool = new pg.Pool({ host: "127.0.0.1", port, database: "postgres", user: "stock_test", ssl: false, max: 8 });
  db = drizzle(pool);
  await pool.query(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE products (id uuid PRIMARY KEY, store_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true, availability boolean NOT NULL DEFAULT true);
    CREATE TABLE product_variants (
      id uuid PRIMARY KEY, product_id uuid NOT NULL REFERENCES products, stock_quantity integer NOT NULL CHECK (stock_quantity >= 0),
      is_active boolean NOT NULL DEFAULT true, availability boolean NOT NULL DEFAULT true, price numeric NOT NULL DEFAULT 70,
      updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE orders (
      id uuid PRIMARY KEY, customer_id uuid NOT NULL, store_id uuid NOT NULL, status text NOT NULL DEFAULT 'PLACED',
      delivery_type text, payment_method text, subtotal numeric, delivery_fee_snapshot numeric, total_amount numeric,
      delivery_address_snapshot jsonb, delivery_contact_name text, delivery_contact_phone text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE order_items (
      id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders, product_id uuid NOT NULL REFERENCES products,
      variant_id uuid NOT NULL REFERENCES product_variants, quantity integer NOT NULL CHECK (quantity > 0),
      product_name_snapshot text, variant_name_snapshot text, product_price_snapshot numeric);
    CREATE TABLE order_status_history (order_id uuid REFERENCES orders, status text);
    GRANT SELECT ON orders TO authenticated;`);
  const migration = await readFile(new URL("../../../../database/migrations/0011_order_inventory.sql", import.meta.url), "utf8");
  await pool.query(migration.replaceAll("--> statement-breakpoint", ""));
}, { timeout: 60_000 });
after(async () => {
  await pool?.end();
  if (directory) {
    await exec("pg_ctl", ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

async function variant(stock: number, storeId: string = randomUUID()): Promise<InventoryLine & { storeId: string }> {
  const productId = randomUUID(), variantId = randomUUID();
  await pool.query("INSERT INTO products (id, store_id) VALUES ($1,$2)", [productId, storeId]);
  await pool.query("INSERT INTO product_variants (id,product_id,stock_quantity) VALUES ($1,$2,$3)", [variantId, productId, stock]);
  return { variantId, productId, storeId, productName: "Historical Rice", variantName: "1 kg", quantity: 3 };
}
async function stock(id: string) {
  return (await pool.query("SELECT stock_quantity FROM product_variants WHERE id=$1", [id])).rows[0].stock_quantity as number;
}
type Intent = { cartId: string; addressId: string; idempotencyKey: string; customerId: string };
function intent(): Intent {
  return { cartId: randomUUID(), addressId: randomUUID(), idempotencyKey: randomUUID(), customerId: randomUUID() };
}
async function place(lines: InventoryLine[], storeId: string, request = intent(), failAfterDeduction = false) {
  customerOrderCreateSchema.parse({ cartId: request.cartId, addressId: request.addressId, idempotencyKey: request.idempotencyKey, paymentMethod: "COD" });
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${request.customerId},0))`);
    const replay = await checkoutReplay(tx, request.customerId, request);
    if (replay) return replay;
    await deductStock(tx, storeId, lines);
    if (failAfterDeduction) throw new Error("Synthetic order insert failure");
    const id = randomUUID();
    await tx.execute(sql`INSERT INTO orders(id,customer_id,store_id,inventory_state,checkout_key,checkout_cart_id,checkout_address_id,total_amount)
      VALUES (${id},${request.customerId},${storeId},'DEDUCTED',${request.idempotencyKey},${request.cartId},${request.addressId},${lines.reduce((total, line) => total + line.quantity * 70, 0)})`);
    for (const line of lines) await tx.execute(sql`INSERT INTO order_items(id,order_id,product_id,variant_id,quantity,product_name_snapshot,variant_name_snapshot,product_price_snapshot)
      VALUES (${randomUUID()},${id},${line.productId},${line.variantId},${line.quantity},${line.productName},${line.variantName},70)`);
    await tx.execute(sql`INSERT INTO order_status_history(order_id,status) VALUES (${id},'PLACED')`);
    return id;
  }, { isolationLevel: "read committed" });
}
async function terminate(id: string, status = "CANCELLED") {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM orders WHERE id=${id} FOR UPDATE`);
    await tx.execute(sql`UPDATE orders SET status=${status} WHERE id=${id}`);
    return restoreOrderStock(tx, id);
  });
}
test("normal deduction: 10 minus 3 is 7, with one order and immutable snapshots", async () => {
  const line = await variant(10);
  const id = await place([line], line.storeId);
  assert.equal(await stock(line.variantId), 7);
  const row = (await pool.query("SELECT * FROM order_items WHERE order_id=$1", [id])).rows[0];
  assert.equal(row.product_name_snapshot, "Historical Rice");
  assert.equal(row.variant_name_snapshot, "1 kg");
  assert.equal(row.product_price_snapshot, "70");
});
test("exact stock: ordering 10 leaves zero and cannot be purchased again", async () => {
  const line = { ...await variant(10), quantity: 10 };
  await place([line], line.storeId);
  assert.equal(await stock(line.variantId), 0);
  await assert.rejects(place([{ ...line, quantity: 1 }], line.storeId), { code: "OUT_OF_STOCK" });
});
test("insufficient stock rejects the entire order and leaves 10 unchanged", async () => {
  const line = { ...await variant(10), quantity: 11 };
  const before = (await pool.query("SELECT count(*) FROM orders")).rows[0].count;
  await assert.rejects(place([line], line.storeId), { code: "INSUFFICIENT_STOCK" });
  assert.equal(await stock(line.variantId), 10);
  assert.equal((await pool.query("SELECT count(*) FROM orders")).rows[0].count, before);
});
test("zero stock rejects an order without changing inventory", async () => {
  const line = { ...await variant(0), quantity: 1 };
  await assert.rejects(place([line], line.storeId), { code: "OUT_OF_STOCK" });
  assert.equal(await stock(line.variantId), 0);
});
for (const quantity of [-1, 0, 1.5, NaN, Infinity, 1000, "malformed"]) {
  test(`server rejects invalid quantity ${quantity}`, async () => {
    const line = await variant(10);
    await assert.rejects(place([{ ...line, quantity: quantity as number }], line.storeId), { code: "INVALID_QUANTITY" });
    assert.equal(await stock(line.variantId), 10);
  });
}
test("multi-item deduction rolls back a first successful item when a later item fails", async () => {
  const a = await variant(10), b = await variant(1, a.storeId);
  const sorted = [a, b].sort((x, y) => x.variantId.localeCompare(y.variantId));
  await pool.query("UPDATE product_variants SET stock_quantity=10 WHERE id=$1", [sorted[0]!.variantId]);
  await pool.query("UPDATE product_variants SET stock_quantity=1 WHERE id=$1", [sorted[1]!.variantId]);
  const countsBefore = (await pool.query("SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS items, (SELECT count(*) FROM order_status_history) AS history")).rows[0];
  await assert.rejects(place(sorted, a.storeId), { code: "INSUFFICIENT_STOCK" });
  assert.equal(await stock(sorted[0]!.variantId), 10);
  assert.equal(await stock(sorted[1]!.variantId), 1);
  assert.deepEqual((await pool.query("SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS items, (SELECT count(*) FROM order_status_history) AS history")).rows[0], countsBefore);
});
test("order insert failure rolls back all already-deducted stock", async () => {
  const line = await variant(10);
  await assert.rejects(place([line], line.storeId, intent(), true), /Synthetic order insert failure/);
  assert.equal(await stock(line.variantId), 10);
});
test("two independent concurrent checkouts cannot oversell stock 5 with quantities 3 and 3", async () => {
  const line = await variant(5);
  const results = await Promise.allSettled([place([line], line.storeId), place([line], line.storeId)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await stock(line.variantId), 2);
});
test("many concurrent orders never deduct more than the original stock", async () => {
  const line = { ...await variant(10), quantity: 2 };
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => place([line], line.storeId)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 5);
  assert.equal(await stock(line.variantId), 0);
});
test("concurrent duplicate submission creates one order, one history entry and one deduction", async () => {
  const line = await variant(10), request = intent();
  const ids = await Promise.all([place([line], line.storeId, request), place([line], line.storeId, request)]);
  assert.equal(ids[0], ids[1]);
  assert.equal(await stock(line.variantId), 7);
  assert.equal((await pool.query("SELECT count(*) FROM order_status_history WHERE order_id=$1", [ids[0]])).rows[0].count, "1");
});
test("reusing a key for a different cart or address fails without another deduction", async () => {
  const line = await variant(10), request = intent();
  await place([line], line.storeId, request);
  for (const changed of [{ ...request, addressId: randomUUID() }, { ...request, cartId: randomUUID() }])
    await assert.rejects(place([line], line.storeId, changed), { code: "IDEMPOTENCY_CONFLICT" });
  assert.equal(await stock(line.variantId), 7);
});
for (const status of ["CANCELLED", "REJECTED"]) {
  test(`${status} restores the original quantity once, even on a duplicate restoration`, async () => {
    const line = await variant(10);
    const id = await place([line], line.storeId);
    assert.equal(await terminate(id, status), true);
    assert.equal(await stock(line.variantId), 10);
    assert.equal(await terminate(id, status), false);
    assert.equal(await stock(line.variantId), 10);
  });
}
test("concurrent restorations cannot restore stock twice", async () => {
  const line = await variant(10);
  const id = await place([line], line.storeId);
  const results = await Promise.all([terminate(id), terminate(id)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await stock(line.variantId), 10);
});
test("legacy orders without a valid original deduction never restore stock", async () => {
  const line = await variant(10), id = randomUUID();
  await pool.query("INSERT INTO orders(id,customer_id,store_id) VALUES($1,$2,$3)", [id, randomUUID(), line.storeId]);
  assert.equal(await terminate(id), false);
  assert.equal(await stock(line.variantId), 10);
});
test("restoration overflow rolls back status, marker and any earlier restored item", async () => {
  const a = await variant(10), b = await variant(10, a.storeId);
  const sorted = [a, b].sort((x, y) => x.variantId.localeCompare(y.variantId));
  const id = await place(sorted, a.storeId);
  await pool.query("UPDATE product_variants SET stock_quantity=2147483647 WHERE id=$1", [sorted[1]!.variantId]);
  await assert.rejects(terminate(id), /could not be restored safely/);
  assert.equal(await stock(sorted[0]!.variantId), 7);
  assert.deepEqual((await pool.query("SELECT status,inventory_state FROM orders WHERE id=$1", [id])).rows[0], { status: "PLACED", inventory_state: "DEDUCTED" });
});
test("vendor/store mismatch cannot deduct or alter another store's inventory or create children", async () => {
  const line = await variant(10);
  const before = (await pool.query("SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS items")).rows[0];
  await assert.rejects(place([line], randomUUID()), { code: "VARIANT_UNAVAILABLE" });
  assert.equal(await stock(line.variantId), 10);
  assert.deepEqual((await pool.query("SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS items")).rows[0], before);
});
test("inactive or unavailable variants never become orderable merely by increasing stock", async () => {
  const line = await variant(5);
  await pool.query("UPDATE product_variants SET stock_quantity=10,is_active=false WHERE id=$1", [line.variantId]);
  await assert.rejects(place([line], line.storeId), { code: "VARIANT_UNAVAILABLE" });
  assert.equal(await stock(line.variantId), 10);
  await pool.query("UPDATE product_variants SET is_active=true,availability=false WHERE id=$1", [line.variantId]);
  await assert.rejects(place([line], line.storeId), { code: "VARIANT_UNAVAILABLE" });
});
test("vendor stock increase affects immediate orderability while old snapshots retain original price", async () => {
  const line = { ...await variant(5), quantity: 6 };
  await assert.rejects(place([line], line.storeId), { code: "INSUFFICIENT_STOCK" });
  await pool.query("UPDATE product_variants SET stock_quantity=10 WHERE id=$1", [line.variantId]);
  const id = await place([line], line.storeId);
  await pool.query("UPDATE product_variants SET price=109 WHERE id=$1", [line.variantId]);
  assert.equal((await pool.query("SELECT product_price_snapshot FROM order_items WHERE order_id=$1", [id])).rows[0].product_price_snapshot, "70");
  assert.equal((await pool.query("SELECT total_amount FROM orders WHERE id=$1", [id])).rows[0].total_amount, "420");
  assert.equal(await stock(line.variantId), 4);
});
test("authenticated database readers cannot read private checkout or inventory markers", async () => {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE authenticated");
    for (const column of ["inventory_state", "checkout_key", "checkout_cart_id", "checkout_address_id"])
      await assert.rejects(client.query(`SELECT ${column} FROM orders`), { code: "42501" });
    await client.query("SELECT id,status,total_amount FROM orders");
  } finally { await client.query("RESET ROLE"); client.release(); }
});
test("deduction/restoration always advance the stock revision consumed by stale vendor forms", async () => {
  const line = await variant(10);
  const before = (await pool.query("SELECT updated_at FROM product_variants WHERE id=$1", [line.variantId])).rows[0].updated_at.getTime();
  const id = await place([line], line.storeId);
  const deducted = (await pool.query("SELECT updated_at FROM product_variants WHERE id=$1", [line.variantId])).rows[0].updated_at.getTime();
  await terminate(id);
  const restored = (await pool.query("SELECT updated_at FROM product_variants WHERE id=$1", [line.variantId])).rows[0].updated_at.getTime();
  assert.ok(deducted > before);
  assert.ok(restored > deducted);
});