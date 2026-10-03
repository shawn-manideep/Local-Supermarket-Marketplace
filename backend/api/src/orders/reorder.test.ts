import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { customerOrderRepeatPreviewQuerySchema, customerOrderRepeatSchema } from "@workspace/validation";
import { evaluateReorderLine, type ReorderLine } from "./reorder.js";
import { planRepeatLineAdditions, repeatIntentMatches } from "./routes.js";

const line: ReorderLine = {
  orderItemId: "history-item", orderProductId: "rice", originalVariantId: "rice-1kg",
  productName: "Historical Basmati Rice", variantNameSnapshot: "1 kg", quantity: 3,
  productId: "rice", productStoreId: "store-a", variantId: "rice-1kg", variantProductId: "rice",
  productActive: true, productAvailable: true, variantActive: true, variantAvailable: true,
  stockQuantity: 20, currentUnitPrice: "75.00",
};
const evaluate = (overrides: Partial<ReorderLine> = {}, storeAvailable = true) =>
  evaluateReorderLine({ ...line, ...overrides }, "store-a", storeAvailable);
const plan = (rows: ReorderLine[], current = new Map<string, number>()) =>
  planRepeatLineAdditions(rows.map(row => ({
    variantId: row.variantId, quantity: row.quantity, stockQuantity: row.stockQuantity,
    available: evaluateReorderLine(row, "store-a", true).available,
  })), current);

test("eligible completed-order item retains exact identity and historical order quantity", () => {
  assert.equal(evaluate().available, true);
  assert.equal(evaluate().quantity, 3);
  assert.deepEqual(plan([line]), [true]);
});
test("another product cannot be substituted even with a matching variant name", () => {
  assert.equal(evaluate({ productId: "similar-rice", variantProductId: "similar-rice" }).available, false);
});
test("another variant of the same product cannot be substituted", () => {
  assert.equal(evaluate({ variantId: "rice-5kg" }).available, false);
});
test("deleted original product or variant remains unavailable", () => {
  for (const missing of [{ productId: null }, { variantId: null }, { originalVariantId: null }, { orderProductId: null }]) {
    assert.equal(evaluate(missing).available, false);
  }
});
test("historical price is ignored in favor of current server variant price", () => {
  const row = { ...line, historicalPrice: "70.00" };
  assert.equal(evaluateReorderLine(row, "store-a", true).currentUnitPrice, "75.00");
  assert.equal(evaluate({ currentUnitPrice: "80.00" }).currentUnitPrice, "80.00");
});
test("current store eligibility and exact original store are required", () => {
  assert.equal(evaluate({}, false).available, false);
  assert.equal(evaluate({ productStoreId: "store-b" }).available, false);
});
test("current product and variant activity and availability are independently checked", () => {
  for (const field of ["productActive", "productAvailable", "variantActive", "variantAvailable"] as const) {
    assert.equal(evaluate({ [field]: false }).available, false);
  }
});
test("zero stock and insufficient stock exclude the exact item without quantity reduction", () => {
  assert.equal(evaluate({ stockQuantity: 0 }).available, false);
  assert.equal(evaluate({ stockQuantity: 2 }).available, false);
  assert.equal(evaluate({ stockQuantity: 3 }).available, true);
  assert.equal(evaluate({ stockQuantity: 2 }).quantity, 3);
});
test("invalid server prices and quantities cannot become purchasable", () => {
  for (const price of [null, "NaN", "Infinity", "-1.00", "75.123", "0", "0.00"]) assert.equal(evaluate({ currentUnitPrice: price }).available, false);
  for (const quantity of [0, -1, 1.5, 1000, NaN]) assert.equal(evaluate({ quantity }).available, false);
});
test("same-store existing quantities are incremented, not replaced", () => {
  const current = new Map([["rice-1kg", 2]]);
  assert.deepEqual(plan([line], current), [true]);
  assert.equal(current.get("rice-1kg"), 5);
});
test("combined cart quantity respects stock and the ordinary cart limit", () => {
  const current = new Map([["rice-1kg", 19]]);
  assert.deepEqual(plan([line], current), [false]);
  assert.equal(current.get("rice-1kg"), 19);
  assert.deepEqual(plan([{ ...line, stockQuantity: 2000 }], new Map([["rice-1kg", 998]])), [false]);
});
test("duplicate historical lines merge only while the combined quantity is valid", () => {
  const current = new Map<string, number>();
  assert.deepEqual(plan([{ ...line, stockQuantity: 5 }, { ...line, stockQuantity: 5 }], current), [true, false]);
  assert.equal(current.get("rice-1kg"), 3);
});
test("partial reorder retains available siblings without replacements", () => {
  const rows = [line, { ...line, orderItemId: "missing", variantActive: false }];
  assert.deepEqual(plan(rows), [true, false]);
});
test("all unavailable items leave planned existing quantities untouched", () => {
  const current = new Map([["rice-1kg", 2]]);
  assert.deepEqual(plan([{ ...line, stockQuantity: 0 }, { ...line, variantActive: false }], current), [false, false]);
  assert.deepEqual([...current], [["rice-1kg", 2]]);
});
test("evaluation and planning do not rewrite historical snapshots", () => {
  const original = JSON.stringify(line);
  const frozen = Object.freeze({ ...line });
  evaluateReorderLine(frozen, "store-a", true);
  plan([frozen]);
  assert.equal(JSON.stringify(frozen), original);
});
test("public reorder item has an exact allowlist and omits inventory and ownership fields", () => {
  assert.deepEqual(Object.keys(evaluate()).sort(), [
    "orderItemId", "productName", "variantNameSnapshot", "quantity", "currentUnitPrice", "available", "reason",
  ].sort());
  assert.equal(evaluate({ variantActive: false }).currentUnitPrice, null);
});
test("strict request schemas reject customer-owned prices and ownership claims", () => {
  const body = { addressId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), orderItemId: crypto.randomUUID() };
  assert.equal(customerOrderRepeatSchema.safeParse(body).success, true);
  for (const field of ["price", "quantity", "productId", "variantId", "storeId", "customerId"]) {
    assert.equal(customerOrderRepeatSchema.safeParse({ ...body, [field]: "injected" }).success, false);
  }
  assert.equal(customerOrderRepeatPreviewQuerySchema.safeParse({ addressId: body.addressId, orderItemId: body.orderItemId }).success, true);
  assert.equal(customerOrderRepeatSchema.safeParse({ ...body, orderItemId: "invalid" }).success, false);
});
test("idempotency scopes distinguish single-item Buy Again from complete Reorder", () => {
  const intent = { sourceOrderId: "order-a", addressId: "address-a", confirmStoreSwitch: false, orderItemId: "item-a" };
  assert.equal(repeatIntentMatches(intent, { ...intent }), true);
  assert.equal(repeatIntentMatches(intent, { ...intent, orderItemId: "item-b" }), false);
  assert.equal(repeatIntentMatches(intent, { ...intent, orderItemId: undefined }), false);
});
test("route contracts enforce ownership and scope items within the owned source order", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const preview = source.slice(source.indexOf("async function repeatOrderPreviewData"), source.indexOf('ordersRouter.post("/api/customer/orders"'));
  const post = source.slice(source.indexOf('ordersRouter.post("/api/customer/orders/:orderId/repeat"'), source.indexOf('ordersRouter.get("/api/customer/orders"'));
  for (const body of [preview, post]) {
    assert.match(body, /eq\(orders\.customerId, customerId\)/);
    assert.match(body, /eq\(customerAddresses\.customerId, customerId\)/);
    assert.match(body, /eq\(orderItems\.orderId, order\.id\)/);
    assert.match(body, /eq\(orderItems\.id, (?:selectedOrderItemId|parsed\.data\.orderItemId)\)/);
    assert.match(body, /Order item not found/);
  }
});
test("mutation revalidates locked rows, rejects store conflicts before writes, and never writes orders or stock", async () => {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const post = source.slice(source.indexOf('ordersRouter.post("/api/customer/orders/:orderId/repeat"'), source.indexOf('ordersRouter.get("/api/customer/orders"'));
  assert.ok(post.indexOf("pg_advisory_xact_lock") < post.indexOf("tx.select().from(customerRepeatRequests)"));
  assert.ok(post.indexOf("lockedVariants") < post.indexOf("evaluateReorderLine(currentRow"));
  assert.ok(post.indexOf("lockedProducts") < post.indexOf("evaluateReorderLine(currentRow"));
  assert.ok(post.indexOf("if (additions.length === 0)") < post.indexOf("tx.insert(carts)"));
  assert.ok(post.indexOf("STORE_SWITCH_REQUIRED") < post.indexOf("tx.insert(carts)"));
  assert.match(post, /target: \[cartItems\.cartId, cartItems\.variantId\]/);
  assert.match(post, /quantity: sql`\$\{cartItems\.quantity\} \+ \$\{row\.quantity\}`/);
  assert.doesNotMatch(post, /tx\.(?:update|insert|delete)\((?:orders|orderItems|orderStatusHistory|products|productVariants|masterProducts)\)/);
  assert.match(post, /added: result\.added \?\? \[\]/);
  assert.doesNotMatch(post.slice(post.indexOf("res.json(")), /selectedOrderItemId/);
});