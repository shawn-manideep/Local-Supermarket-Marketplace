import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { vendorOrderActionSchema, vendorOrderQuerySchema } from "@workspace/validation";
import { LEGAL_ORDER_TRANSITIONS } from "./lifecycle.js";

for (const [action, from, to] of [
  ["ACCEPT", "PLACED", "ACCEPTED"],
  ["REJECT", "PLACED", "REJECTED"],
  ["PREPARE", "ACCEPTED", "PREPARING"],
  ["READY", "PREPARING", "READY"],
] as const) {
  test(`existing authoritative lifecycle permits ${from} → ${to}`, () => {
    assert.equal(LEGAL_ORDER_TRANSITIONS[action]![from], to);
    assert.equal(vendorOrderActionSchema.safeParse({ action }).success, true);
  });
}
test("skips, late rejection, terminal actions and duplicate accept/reject are not legal", () => {
  assert.equal(LEGAL_ORDER_TRANSITIONS.PREPARE!.PLACED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.READY!.PLACED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.READY!.ACCEPTED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.ACCEPT!.ACCEPTED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.REJECT!.REJECTED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.REJECT!.ACCEPTED, undefined);
  assert.equal(LEGAL_ORDER_TRANSITIONS.REJECT!.PREPARING, undefined);
  for (const status of ["DELIVERED", "CANCELLED", "REJECTED"])
    for (const action of ["ACCEPT", "REJECT", "PREPARE", "READY"])
      assert.equal(LEGAL_ORDER_TRANSITIONS[action]![status], undefined);
});
test("vendor queries and actions reject forged store, customer, snapshots and arbitrary statuses", () => {
  assert.equal(vendorOrderQuerySchema.safeParse({ status: "PLACED" }).success, true);
  assert.equal(vendorOrderQuerySchema.safeParse({ storeId: crypto.randomUUID() }).success, false);
  assert.equal(vendorOrderActionSchema.safeParse({ status: "READY" }).success, false);
  assert.equal(vendorOrderActionSchema.safeParse({ action: "REJECT", note: "Unavailable for fulfillment" }).success, true);
  for (const field of ["storeId", "customerId", "totalAmount", "items", "variantId"])
    assert.equal(vendorOrderActionSchema.safeParse({ action: "ACCEPT", [field]: "forged" }).success, false);
});

async function vendorRoutes() {
  const source = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  return {
    source,
    list: source.slice(source.indexOf('ordersRouter.get("/api/vendor/orders",'), source.indexOf('ordersRouter.get("/api/vendor/orders/:orderId",')),
    detail: source.slice(source.indexOf('ordersRouter.get("/api/vendor/orders/:orderId",'), source.indexOf('ordersRouter.post("/api/vendor/orders/:orderId/actions",')),
    action: source.slice(source.indexOf('ordersRouter.post("/api/vendor/orders/:orderId/actions",'), source.indexOf("const adminOrderListFields")),
  };
}
test("new orders, list totals and status counts all use the authenticated vendor's store scope", async () => {
  const { list } = await vendorRoutes();
  assert.match(list, /requireRole\("vendor"\)/);
  assert.match(list, /auth\?\.storeId/);
  assert.match(list, /eq\(orders\.storeId, storeId\)/);
  assert.match(list, /status !== "ALL" \? \[eq\(orders\.status, status\)\]/);
  assert.match(list, /where\(where\)/);
  assert.match(list, /where\(eq\(orders\.storeId, storeId\)\)\.groupBy\(orders\.status\)/);
  assert.match(list, /where\(inArray\(orderItems\.orderId, ids\)\)/);
});
test("unauthorized details fail before reading any items or customer fulfillment snapshots", async () => {
  const { detail } = await vendorRoutes();
  assert.match(detail, /requireRole\("vendor"\)/);
  assert.match(detail, /eq\(orders\.id, id\), eq\(orders\.storeId, storeId\)/);
  const ownershipGuard = detail.indexOf('if (!order) throw new HttpError(404, "Order not found")');
  assert.ok(ownershipGuard >= 0);
  assert.ok(ownershipGuard < detail.indexOf("select(safeItemFields)"));
  assert.ok(ownershipGuard < detail.indexOf("select(safeHistoryFields)"));
});
test("cross-vendor and invalid actions throw inside the transaction before parent or history writes", async () => {
  const { action } = await vendorRoutes();
  const transaction = action.indexOf("getDb().transaction");
  const ownershipGuard = action.indexOf('if (!order) throw new HttpError(404, "Order not found")');
  const transitionGuard = action.indexOf('if (!next) throw new HttpError(409');
  const parentWrite = action.indexOf("tx.update(orders)");
  const childWrite = action.indexOf("tx.insert(orderStatusHistory)");
  assert.match(action, /eq\(orders\.id, id\), eq\(orders\.storeId, storeId\)/);
  assert.match(action, /\.for\("update"\)/);
  assert.match(action, /LEGAL_ORDER_TRANSITIONS\[parsed\.data\.action\]\?\.\[order\.status\]/);
  assert.ok(transaction < ownershipGuard && ownershipGuard < transitionGuard);
  assert.ok(transitionGuard < parentWrite && parentWrite < childWrite);
  assert.match(action, /isolationLevel: "read committed"/);
});
test("each valid transition appends existing status history with optional reason and actor", async () => {
  const { action } = await vendorRoutes();
  assert.match(action, /tx\.insert\(orderStatusHistory\)\.values\(\{ orderId: id, status: next as typeof order\.status, note: parsed\.data\.note, changedBy: userId\(req\)/);
  assert.doesNotMatch(action, /(?:update|delete)\(orderStatusHistory\)/);
});
test("operational updates preserve every commercial snapshot and never touch inventory or catalog", async () => {
  const { action, detail } = await vendorRoutes();
  assert.match(action, /set\(\{ status: next as typeof order\.status, updatedAt: new Date\(\) \}\)/);
  assert.doesNotMatch(action, /(?:update|delete|insert)\((?:orderItems|products|productVariants|masterProducts|customerAddresses|userProfiles)\)/);
  assert.doesNotMatch(detail, /innerJoin\((?:products|productVariants|masterProducts)/);
});
test("safe vendor responses expose only order fulfillment and historical commercial allowlists", async () => {
  const { source, list, detail, action } = await vendorRoutes();
  const orderFields = source.slice(source.indexOf("const safeOrderFields"), source.indexOf("const safeOrderSummaryFields"));
  const itemFields = source.slice(source.indexOf("const safeItemFields"), source.indexOf("const safeHistoryFields"));
  assert.match(itemFields, /variantNameSnapshot: orderItems\.variantNameSnapshot/);
  assert.match(itemFields, /productPriceSnapshot: orderItems\.productPriceSnapshot/);
  for (const body of [orderFields, itemFields, list, detail, action])
    assert.doesNotMatch(body, /password|sku|externalCode|commissionAmountSnapshot|commissionRateSnapshot|customerId|userProfiles/);
  assert.match(detail, /select\(safeItemFields\)/);
  assert.match(action, /select\(\{ \.\.\.safeOrderFields/);
  assert.doesNotMatch(action, /res\.json\(\{ order: updated \}\)/);
});
test("vendor and customer read the same persisted status, without a second status model", async () => {
  const { source } = await vendorRoutes();
  const customer = source.slice(source.indexOf('ordersRouter.get("/api/customer/orders/:orderId",'), source.indexOf('ordersRouter.post("/api/customer/orders/:orderId/cancel",'));
  assert.match(source, /status: orders\.status/);
  assert.match(customer, /safeOrderFields/);
  const customerUi = await readFile(new URL("../../../../apps/customer/src/OrdersScreen.tsx", import.meta.url), "utf8");
  assert.match(customerUi, /localOrder\.status\.replaceAll/);
  assert.doesNotMatch(customer, /vendorPreparationStatus|deliveryPartnerStatus/);
});