import assert from "node:assert/strict";
import test from "node:test";
import type { CustomerOrderSummary, RepeatOrderPreview } from "./api";
import { homeHistorySelection, homeRecentStore, homePreviewRows, homeItemAvailable } from "./home-history";

const order = (id: string, status: CustomerOrderSummary["status"] = "DELIVERED", storeId = "store-a"): CustomerOrderSummary => ({
  id, status, storeId, storeName: "Actual supermarket", totalAmount: "777.00", createdAt: "2026-10-04T05:00:00Z", itemSummary: [],
});
const preview = (available = true): RepeatOrderPreview => ({
  storeAvailable: available, storeSwitchRequired: false, storeName: "Actual supermarket", existingStoreName: null, canAddCount: available ? 1 : 0,
  items: [{ orderItemId: "original-line", productName: "Historical Rice", variantNameSnapshot: "Original 1 kg", quantity: 3, currentUnitPrice: "99.50", available, reason: available ? null : "Currently unavailable" }],
});
test("empty customer history cannot invent orders, active orders or a recent store", () => {
  assert.deepEqual(homeHistorySelection([]), { recent: [], activeOrder: null, hasHistory: false });
  assert.equal(homeRecentStore([], [{ id: "store-a" }]), null);
});
test("recent history is bounded to two real noncancelled orders in authoritative list order", () => {
  const data = [order("cancelled", "CANCELLED"), order("rejected", "REJECTED"), order("new"), order("older"), order("oldest")];
  assert.deepEqual(homeHistorySelection(data).recent.map(item => item.id), ["new", "older"]);
  assert.equal(data.length, 5);
});
test("cancelled/rejected-only history is not misrepresented as no orders", () => {
  const selected = homeHistorySelection([order("cancelled", "CANCELLED"), order("rejected", "REJECTED")]);
  assert.equal(selected.hasHistory, true);
  assert.equal(selected.recent.length, 0);
  assert.equal(selected.activeOrder, null);
});
test("Recent Store uses the latest relevant order and requires current eligibility", () => {
  const orders = [order("latest", "PLACED", "store-b"), order("older")];
  assert.equal(homeRecentStore(orders, [{ id: "store-a" }]), null);
  assert.deepEqual(homeRecentStore(orders, [{ id: "store-a" }, { id: "store-b" }]), { id: "store-b" });
});
test("active order visibility preserves READY and Phase 7 delivery status rather than another status model", () => {
  for (const status of ["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] as const) {
    assert.equal(homeHistorySelection([order("delivered"), order("active", status)]).activeOrder?.status, status);
  }
  assert.equal(homeHistorySelection([order("delivered")]).activeOrder, null);
});
test("preview rows preserve exact source-order/item/variant labels, quantity and current price", () => {
  const p = preview();
  const [row] = homePreviewRows([{ orderId: "original-order", preview: p }]);
  assert.equal(row.orderId, "original-order");
  assert.equal(row.item.orderItemId, "original-line");
  assert.equal(row.item.variantNameSnapshot, "Original 1 kg");
  assert.equal(row.item.quantity, 3);
  assert.equal(row.item.currentUnitPrice, "99.50");
  assert.equal(row.item, p.items[0]);
  assert.equal("productPriceSnapshot" in row.item, false);
});
test("Home displays at most four actual preview lines without inventing a replacement", () => {
  const p = preview();
  p.items = Array.from({ length: 6 }, (_, i) => ({ ...p.items[0], orderItemId: `line-${i}` }));
  assert.deepEqual(homePreviewRows([{ orderId: "source", preview: p }]).map(row => row.item.orderItemId), ["line-0", "line-1", "line-2", "line-3"]);
  assert.equal(p.items.length, 6);
});
test("unavailable stores/items retain exact historical identity but disable Buy Again", () => {
  for (const p of [preview(false), { ...preview(), storeAvailable: false }]) {
    const [row] = homePreviewRows([{ orderId: "source", preview: p }]);
    assert.equal(homeItemAvailable(row), false);
    assert.equal(row.item.orderItemId, "original-line");
  }
});
test("current price must be positive and valid; null/invalid/zero never fall back to a historical price", () => {
  const [row] = homePreviewRows([{ orderId: "source", preview: preview() }]);
  for (const price of [null, "", "0", "-10", "NaN", "Infinity"]) {
    assert.equal(homeItemAvailable({ ...row, item: { ...row.item, currentUnitPrice: price } }), false);
  }
  assert.equal(homeItemAvailable(row), true);
});