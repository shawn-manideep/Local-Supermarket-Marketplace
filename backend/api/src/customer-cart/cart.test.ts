import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { customerCartItemCreateSchema, customerCartItemUpdateSchema, customerCheckoutValidationSchema } from "@workspace/validation";
import { createApp } from "../app.js";
import { centsToMoney, moneyToCents } from "./money.js";
import { cartStatusAfterItemRemoval } from "./routes.js";

test("cart and checkout routes require authentication", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    for (const [method, path] of [["GET", "/api/customer/cart"], ["POST", "/api/customer/cart/items"], ["POST", "/api/customer/checkout/validate"]] as const) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${path}`, { method })).status, 401);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("cart inputs reject protected values and unsafe quantities", () => {
  assert.equal(customerCartItemCreateSchema.safeParse({ productId: crypto.randomUUID(), quantity: 1, price: 1 }).success, false);
  assert.equal(customerCartItemCreateSchema.safeParse({ productId: crypto.randomUUID(), quantity: -1 }).success, false);
  assert.equal(customerCartItemUpdateSchema.safeParse({ quantity: 0 }).success, true);
  assert.equal(customerCartItemUpdateSchema.safeParse({ quantity: 1000 }).success, false);
  assert.equal(customerCheckoutValidationSchema.safeParse({ addressId: crypto.randomUUID(), paymentMethod: "CARD" }).success, false);
});

test("money calculations remain integer-cent based", () => {
  assert.equal(moneyToCents("12.30"), 1230n);
  assert.equal(centsToMoney(1230n), "12.30");
  assert.equal(centsToMoney(moneyToCents("19.99") * 3n), "59.97");
});

test("removing cart items abandons only an empty active cart", () => {
  assert.equal(cartStatusAfterItemRemoval(0), "ABANDONED");
  assert.equal(cartStatusAfterItemRemoval(1), "ACTIVE");
});

test("direct customer cart writes are removed from RLS", async () => {
  const migration = await readFile(
    new URL("../../../../database/migrations/0002_secure_customer_cart_writes.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /DROP POLICY IF EXISTS carts_customer_insert/);
  assert.match(migration, /DROP POLICY IF EXISTS carts_customer_update/);
  assert.match(migration, /DROP POLICY IF EXISTS cart_items_customer_manage/);
  assert.doesNotMatch(migration, /orders|order_items|order_status_history/);
});