import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { customerCartItemCreateSchema, customerOrderCreateSchema, productStockQuantitySchema } from "@workspace/validation";
import { stockError } from "./inventory.js";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
test("checkout contract requires validated cart and stable key and rejects client commercial/ownership fields", () => {
  const request = { cartId: crypto.randomUUID(), addressId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), paymentMethod: "COD" };
  assert.equal(customerOrderCreateSchema.safeParse(request).success, true);
  assert.equal(customerOrderCreateSchema.safeParse({ addressId: request.addressId, paymentMethod: "COD" }).success, false);
  for (const field of ["quantity", "price", "stock", "storeId", "customerId", "inventoryState"])
    assert.equal(customerOrderCreateSchema.safeParse({ ...request, [field]: "forged" }).success, false);
});
test("stock errors have consistent public codes and affected historical item/variant labels, not counts", () => {
  for (const code of ["OUT_OF_STOCK", "INSUFFICIENT_STOCK", "VARIANT_UNAVAILABLE", "INVALID_QUANTITY"] as const) {
    const error = stockError(code, { productName: "Rice", variantName: "1 kg" });
    assert.equal(error.code, code);
    assert.match(error.message, /Rice \(1 kg\)/);
    assert.doesNotMatch(JSON.stringify(error), /stockQuantity|stock_quantity|variantId|productId|SELECT|UPDATE/);
  }
});
test("variant quantities stay integer packs and vendor stock input rejects malformed/negative/overflow", () => {
  for (const quantity of [-1, 0, 1.5, NaN, Infinity, 1000])
    assert.equal(customerCartItemCreateSchema.safeParse({ variantId: crypto.randomUUID(), quantity }).success, false);
  for (const stockQuantity of [-1, 1.5, "invalid", Infinity, 2147483648])
    assert.equal(productStockQuantitySchema.safeParse({ stockQuantity }).success, false);
  assert.equal(productStockQuantitySchema.safeParse({ stockQuantity: 0 }).success, true);
});
test("checkout replay precedes active-cart lookup; deduction, snapshots, history and conversion share one transaction", async () => {
  const text = await source("./routes.ts");
  const create = text.slice(text.indexOf('ordersRouter.post("/api/customer/orders",'), text.indexOf('ordersRouter.get("/api/customer/orders/:orderId/repeat-preview",'));
  assert.ok(create.indexOf("pg_advisory_xact_lock") < create.indexOf("checkoutReplay"));
  assert.ok(create.indexOf("checkoutReplay") < create.indexOf("eq(carts.status"));
  assert.ok(create.indexOf("deductStock") < create.indexOf("tx.insert(orders)"));
  assert.ok(create.indexOf("tx.insert(orders)") < create.indexOf("tx.insert(orderItems)"));
  assert.ok(create.indexOf("tx.insert(orderItems)") < create.indexOf("tx.insert(orderStatusHistory)"));
  assert.ok(create.indexOf("tx.insert(orderStatusHistory)") < create.indexOf('status: "CONVERTED"'));
  assert.match(create, /eq\(carts\.id, parsed\.data\.cartId\), eq\(carts\.customerId, customerId\)/);
  assert.match(create, /inventoryState: "DEDUCTED"/);
});
test("authorized placed cancellation and rejection restore inside their status/history transaction only", async () => {
  const text = await source("./routes.ts");
  const cancel = text.slice(text.indexOf('ordersRouter.post("/api/customer/orders/:orderId/cancel",'), text.indexOf('ordersRouter.get("/api/vendor/orders",'));
  const action = text.slice(text.indexOf('ordersRouter.post("/api/vendor/orders/:orderId/actions",'), text.indexOf("const adminOrderListFields"));
  assert.match(cancel, /eq\(orders\.customerId, customerId\)/);
  assert.match(cancel, /order\.status !== "PLACED"/);
  for (const body of [cancel, action]) {
    assert.ok(body.indexOf('throw new HttpError(404, "Order not found")') < body.indexOf("restoreOrderStock"));
    assert.ok(body.indexOf("tx.update(orders)") < body.indexOf("restoreOrderStock"));
    const restoreAt=body.indexOf("restoreOrderStock");
    assert.ok(restoreAt < body.indexOf("tx.insert(orderStatusHistory)",restoreAt));
    assert.doesNotMatch(body, /deductStock/);
  }
  assert.match(action, /if \(next === "REJECTED"\) await restoreOrderStock/);
});
test("cart and reorder never consume or reserve inventory; public cart strips stock and explains unavailability", async () => {
  const cart = await source("../customer-cart/routes.ts");
  const orders = await source("./routes.ts");
  const repeat = orders.slice(orders.indexOf('ordersRouter.post("/api/customer/orders/:orderId/repeat",'), orders.indexOf('ordersRouter.get("/api/customer/orders",'));
  for (const text of [cart, repeat]) assert.doesNotMatch(text, /deductStock|restoreOrderStock|update\(productVariants\)|stock_quantity\s*=/);
  assert.match(cart, /isActive, stockQuantity, productAvailability, productIsActive, \.\.\.item/);
  assert.match(cart, /unavailableReason:/);
  assert.match(cart, /"OUT_OF_STOCK"/);
});
test("manual stock updates resolve ownership and lock variants before any parent or child update", async () => {
  const text = await source("../catalog-management/routes.ts");
  const stock = text.slice(text.indexOf('catalogManagementRouter.patch("/api/vendor/products/:productId/stock-quantity",'), text.indexOf('catalogManagementRouter.patch("/api/vendor/products/:productId/category",'));
  assert.match(stock, /requireRole\("vendor"\)/);
  assert.ok(stock.indexOf('if (!owned) throw new HttpError(404') < stock.indexOf("transaction.update(products)"));
  assert.match(stock, /productOwnershipPredicate\(storeId, id\)/);
  assert.match(stock, /orderBy\(asc\(productVariants\.id\)\)\.for\("update"\)/);
  assert.doesNotMatch(stock, /isActive: true|availability: true|masterProducts/);
});
test("safe order responses exclude new private inventory and checkout markers", async () => {
  const text = await source("./routes.ts");
  const fields = text.slice(text.indexOf("const safeOrderFields"), text.indexOf("const ORDER_STATUSES"));
  assert.doesNotMatch(fields, /inventoryState|checkoutKey|checkoutCartId|checkoutAddressId|stockQuantity/);
});
test("migration is additive, legacy orders remain NONE, and checkout identities and inventory effects are protected", async () => {
  const migration = await source("../../../../database/migrations/0011_order_inventory.sql");
  assert.match(migration, /DEFAULT 'NONE'/);
  assert.match(migration, /CREATE UNIQUE INDEX orders_customer_checkout_key_uidx/);
  assert.match(migration, /CREATE UNIQUE INDEX orders_checkout_cart_uidx/);
  assert.match(migration, /OLD\.inventory_state = 'DEDUCTED' AND NEW\.inventory_state = 'RESTORED'/);
  assert.doesNotMatch(migration, /UPDATE public\.order_items|DELETE FROM|DROP TABLE|CREATE TABLE|RENAME/);
});
test("customer checkout retains a stable retry identity and does not silently remove unavailable cart items", async () => {
  const cart = await source("../../../../apps/customer/src/CartScreen.tsx");
  assert.match(cart, /idempotencyKey: intent\.key/);
  assert.match(cart, /checkoutIntent\.current/);
  assert.doesNotMatch(cart, /checkout\/validate/);
  assert.match(cart, /INSUFFICIENT_STOCK/);
  assert.match(cart, /No longer available in the selected quantity/);
  assert.doesNotMatch(cart, /stockQuantity|stock_quantity|items\.filter/);
  const shopping = await source("../../../../apps/customer/src/lib/shopping.ts");
  assert.match(shopping, /OUT_OF_STOCK.*INSUFFICIENT_STOCK/);
});