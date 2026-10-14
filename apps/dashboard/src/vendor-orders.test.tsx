import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VendorOrderReceipt } from "./VendorOrderReceipt";
import { actionProgress, createVendorActionGate, historicalVariantLabel, vendorActions, vendorEmptyMessage, vendorStatusLabel } from "./vendor-orders";

test("placed orders offer accept and reject; accepted and preparing offer only ready", () => {
  assert.deepEqual(vendorActions("PLACED", "orders").map(item => item.action), ["ACCEPT", "REJECT"]);
  assert.deepEqual(vendorActions("ACCEPTED", "orders").map(item => item.action), ["READY"]);
  assert.deepEqual(vendorActions("PREPARING", "orders").map(item => item.action), ["READY"]);
});
test("preparation stops at ready and historical or terminal statuses offer no preparation action", () => {
  for (const status of ["READY", "OUT_FOR_DELIVERY", "DELIVERED", "REJECTED", "CANCELLED"] as const)
    assert.deepEqual(vendorActions(status, "orders"), []);
});
test("vendor delivery view never dispatches or completes partner deliveries", () => {
  assert.deepEqual(vendorActions("READY", "delivery"), []);
  assert.deepEqual(vendorActions("OUT_FOR_DELIVERY", "delivery"), []);
  assert.deepEqual(vendorActions("PLACED", "delivery"), []);
});
test("vendor order details use partner assignment contracts and hide opaque selection IDs", async () => {
  const source = await readFile(new URL("./OrderOperations.tsx", import.meta.url), "utf8");
  const panel = source.slice(source.indexOf("function VendorDeliveryAssignmentPanel"), source.indexOf("function AdminSummaryTiles"));
  assert.match(panel, /\/api\/vendor\/orders\/\$\{encodeURIComponent\(detail\.id\)\}\/delivery/);
  assert.match(panel, /\/api\/vendor\/delivery-partners/);
  assert.match(panel, /partner\.status === "ACTIVE"/);
  assert.match(panel, /detail\.status === "READY" && canReplace/);
  assert.match(panel, /const replaceable = !response\.assignment \|\| \["PENDING", "REJECTED", "CANCELLED"\]\.includes\(response\.assignment\.status\)/);
  assert.match(panel, /const canReplace = !assignment \|\| \["PENDING", "REJECTED", "CANCELLED"\]\.includes\(assignment\.status\)/);
  assert.match(panel, /Replacing this assignment will cancel the current pending duty/);
  assert.match(panel, /Replace pending delivery\?/);
  assert.doesNotMatch(panel, /\["PENDING", "REJECTED", "CANCELLED", "ACCEPTED"|canReplace = .*PICKED_UP|canReplace = .*OUT_FOR_DELIVERY/);
  assert.match(panel, /JSON\.stringify\(\{ partnerId \}\)/);
  assert.match(panel, /assignment\.partnerName/);
  assert.match(panel, /<option key=\{partner\.id\} value=\{partner\.id\}>\{partner\.displayName\}<\/option>/);
  assert.doesNotMatch(panel, /<strong>\{assignment\.id\}|>Delivery · \{assignment\.id\}</);
  assert.match(source, /<VendorDeliveryAssignmentPanel token=\{token\} detail=\{detail\} disabled=\{busy\} \/>/);
  assert.match(panel, /window\.setInterval\(refreshWhenVisible, 45_000\)/);
  assert.match(panel, /requestScope !== renderedScope\.current/);
});
test("snapshot variant names are preserved exactly, with snapshot-only legacy fallback", () => {
  assert.equal(historicalVariantLabel({ variantNameSnapshot: "Original Brand — 1 kg" }), "Original Brand — 1 kg");
  assert.equal(historicalVariantLabel({ variantNameSnapshot: null, variantQuantityValueSnapshot: "1.000", variantQuantityUnitSnapshot: "kg" }), "1 kg");
  assert.equal(historicalVariantLabel({}), "Variant not recorded");
});
const detail = {
  items: [{
    id: "internal-item", variantId: "internal-variant", productNameSnapshot: "Historical Rice",
    variantNameSnapshot: "1 kg", quantity: 2, productPriceSnapshot: "70.00", subtotal: "140.00",
  }],
  subtotal: "140.00", deliveryFeeSnapshot: "15.00", totalAmount: "155.00",
};
test("rendered vendor receipt shows exact historical product, variant, quantity, unit and line price", () => {
  const html = renderToStaticMarkup(createElement(VendorOrderReceipt, { detail }));
  for (const value of ["Historical Rice", "1 kg", "Qty: 2", "₹70.00 each", "₹140.00"])
    assert.ok(html.includes(value), value);
  assert.ok(!html.includes("internal-item"));
  assert.ok(!html.includes("internal-variant"));
});
test("today's price and product name cannot overwrite rendered historical values or totals", () => {
  const input = { ...detail, currentPrice: "75.00", currentProductName: "New Rice", currentTotal: "165.00" };
  const before = JSON.stringify(input);
  const html = renderToStaticMarkup(createElement(VendorOrderReceipt, { detail: input }));
  assert.ok(html.includes("₹155.00"));
  assert.ok(html.includes("₹15.00"));
  assert.ok(!html.includes("₹75.00"));
  assert.ok(!html.includes("New Rice"));
  assert.ok(!html.includes("₹165.00"));
  assert.equal(JSON.stringify(input), before);
});
test("missing historical variant is explained rather than replaced with a current option", () => {
  const html = renderToStaticMarkup(createElement(VendorOrderReceipt, {
    detail: { ...detail, items: [{ ...detail.items[0]!, variantNameSnapshot: undefined }] },
  }));
  assert.ok(html.includes("Variant not recorded"));
});
for (const action of ["ACCEPT", "REJECT"] as const) {
  test(`synchronous ${action.toLowerCase()} guard prevents a double submission until completion`, () => {
    const gate = createVendorActionGate();
    assert.equal(gate.start(), true);
    assert.equal(gate.pending, true);
    assert.equal(gate.start(), false);
    gate.finish();
    assert.equal(gate.pending, false);
    assert.equal(gate.start(), true);
  });
}
test("new, filtered and all-orders empty states are distinct", () => {
  assert.equal(vendorEmptyMessage("PLACED"), "No new orders");
  assert.equal(vendorEmptyMessage("READY"), "No orders found in this status.");
  assert.equal(vendorEmptyMessage("ALL"), "No orders yet");
  assert.equal(vendorStatusLabel("PLACED"), "New / Placed");
  assert.equal(vendorStatusLabel("DELIVERED"), "Completed / Delivered");
});
test("each visible vendor action has a specific progress label without manual preparing", () => {
  assert.equal(actionProgress.ACCEPT, "Accepting...");
  assert.equal(actionProgress.REJECT, "Rejecting...");
  assert.equal(actionProgress.READY, "Marking ready...");
  assert.deepEqual(Object.keys(actionProgress).sort(), ["ACCEPT", "READY", "REJECT"]);
});
test("detail opens as its own view, with fulfillment, receipt, actions and append-only timeline in order", async () => {
  const source = await readFile(new URL("./OrderOperations.tsx", import.meta.url), "utf8");
  const vendor = source.slice(source.indexOf("function VendorDetail"));
  assert.match(vendor, /if \(detailTargetId\) return/);
  assert.match(vendor, /deliveryAddressSnapshot\.line1/);
  assert.match(vendor, /deliveryContactPhone/);
  assert.ok(vendor.indexOf("Customer & Delivery") < vendor.indexOf("<VendorOrderReceipt"));
  assert.ok(vendor.indexOf("<VendorOrderReceipt") < vendor.indexOf("Vendor Actions"));
  assert.ok(vendor.indexOf("Vendor Actions") < vendor.indexOf("Order Timeline"));
  assert.match(vendor, /Ready for fulfillment/);
  assert.doesNotMatch(vendor, /Order Reference: \{detail\.id\}/);
});
test("rejection needs accessible confirmation and preserves the optional reason", async () => {
  const source = await readFile(new URL("./OrderOperations.tsx", import.meta.url), "utf8");
  assert.match(source, /rejectionDialog\.current\?\.showModal\(\)/);
  assert.match(source, /aria-labelledby="vendor-reject-title"/);
  assert.match(source, /Reject this order\?/);
  assert.match(source, /setRejectVisible\(false\)\}>Cancel/);
  assert.match(source, /onAction\("REJECT", note\.trim\(\) \|\| undefined\)/);
});
test("vendor refresh is manual, periodic and visibility-aware without a second status architecture", async () => {
  const source = await readFile(new URL("./OrderOperations.tsx", import.meta.url), "utf8");
  const vendor = source.slice(source.indexOf("function VendorOrderOperations"));
  assert.match(vendor, /window\.setInterval\(refreshVisible, 12_000\)/);
  assert.match(vendor, /document\.visibilityState !== "visible"/);
  assert.match(vendor, /window\.addEventListener\("focus", refreshVisible\)/);
  assert.match(vendor, /window\.clearInterval\(timer\)/);
  assert.match(vendor, /Refresh Order/);
  assert.match(vendor, /Refresh List/);
  assert.match(vendor, /setSelected\(response\.order\)/);
  assert.match(vendor, /requestGeneration === detailGeneration\.current && requestScope === currentScope\.current/);
  assert.match(vendor, /setDetailRefreshing\(true\)/);
  assert.match(vendor, /void load\(true\)/);
  assert.match(vendor, /void openDetail\(detailTargetId, true\)/);
  assert.match(vendor, /setOrders\(\[\]\); setCounts\(\{\}\)/);
  assert.match(vendor, /renderedScope\.current !== scope/);
});
test("vendor errors omit raw diagnostics and stale detail prevents actions", async () => {
  const source = await readFile(new URL("./OrderOperations.tsx", import.meta.url), "utf8");
  const vendor = source.slice(source.indexOf("function VendorOrderOperations"));
  assert.doesNotMatch(vendor, /cause\.message/);
  assert.match(vendor, /We couldn't load your orders/);
  assert.match(vendor, /We couldn't update this order/);
  assert.match(vendor, /detailLoading \|\| detailRefreshing \|\| detailError \|\| error/);
  assert.match(vendor, /!actionGate\.current\.start\(\)/);
});
test("tablet and phone queue layouts stack labeled cells and keep details and confirmation in viewport", async () => {
  const css = await readFile(new URL("./vendor-orders.css", import.meta.url), "utf8");
  assert.match(css, /max-width: 850px/);
  assert.match(css, /max-width: 480px/);
  assert.match(css, /content: attr\(data-label\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /max-height: calc\(100dvh - 32px\)/);
  assert.match(css, /\.vendor-preparation-detail \.vendor-detail-layout \{ grid-template-columns: minmax\(0, 1fr\)/);
});