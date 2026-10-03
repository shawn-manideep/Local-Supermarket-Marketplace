import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reorderInput, reorderItemLabel, reorderPreviewQuery, reorderSummary } from "./reorder";

test("whole-order reorder sends only address, retry key and explicit switch confirmation", () => {
  assert.deepEqual(reorderInput("address", "key"), { addressId: "address", idempotencyKey: "key", confirmStoreSwitch: false });
});
test("individual Buy Again sends the historical order-item identity, never client price or variant", () => {
  assert.deepEqual(reorderInput("address", "key", "original-item", true), {
    addressId: "address", idempotencyKey: "key", confirmStoreSwitch: true, orderItemId: "original-item",
  });
});
test("availability preview uses the same optional individual-item scope", () => {
  assert.deepEqual(Object.fromEntries(new URLSearchParams(reorderPreviewQuery("address", "item"))), { addressId: "address", orderItemId: "item" });
  assert.equal(new URLSearchParams(reorderPreviewQuery("address")).has("orderItemId"), false);
});
test("full, partial and zero-addition summaries never claim empty success", () => {
  assert.equal(reorderSummary({ addedCount: 2, unavailable: [] }), "Items added to your cart");
  const unavailable = [{ orderItemId: "a", productName: "Eggs", variantNameSnapshot: "12 pieces", quantity: 1, currentUnitPrice: null, available: false, reason: "Insufficient stock" }];
  assert.equal(reorderSummary({ addedCount: 1, unavailable }), "Partially available");
  assert.equal(reorderSummary({ addedCount: 0, unavailable }), "None of these items are currently available.");
});
test("customer item labels preserve historical names and pack labels without IDs", () => {
  assert.equal(reorderItemLabel({ productName: "Rice", variantNameSnapshot: "1 kg" }), "Rice — 1 kg");
  assert.equal(reorderItemLabel({ productName: "Rice", variantNameSnapshot: null }), "Rice");
});
test("order history exposes both reorder scopes without changing historical prices", async () => {
  const screen = await readFile(new URL("../OrdersScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /startReorder\(order\.id\)/);
  assert.match(screen, /onRepeat\(item\.id\)/);
  assert.match(screen, /money\(item\.productPriceSnapshot\)/);
  assert.match(screen, /!!order\.itemSummary\?\.length/);
  assert.match(screen, /localOrder\.items\.length > 0/);
});
test("success remains in summary until View Cart or Continue Shopping is chosen", async () => {
  const screen = await readFile(new URL("../OrdersScreen.tsx", import.meta.url), "utf8");
  const submission = screen.slice(screen.indexOf("const addAvailableItems"), screen.indexOf("return <><Modal"));
  assert.match(submission, /setResult\(result\)/);
  assert.doesNotMatch(submission, /onAdded\(\)/);
  assert.match(screen, /result\.added\.map/);
  assert.match(screen, /result\.unavailable\.map/);
  assert.match(screen, /result\.addedCount > 0 && <Pressable.*onPress=\{onAdded\}/);
  assert.match(screen, /onPress=\{onContinueShopping\}/);
});
test("store switch requires named destructive confirmation and blocks duplicate submissions", async () => {
  const screen = await readFile(new URL("../OrdersScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /preview\.storeSwitchRequired && !confirmedStoreSwitch/);
  assert.match(screen, /confirmLabel="Clear Cart & Continue" cancelLabel="Cancel"/);
  assert.match(screen, /preview\?\.existingStoreName/);
  assert.match(screen, /submissionInFlight\.current = true/);
  assert.match(screen, /disabled=\{submitting\}/);
  assert.match(screen, /intent\.orderItemId !== orderItemId/);
  assert.match(screen, /intent\.confirmStoreSwitch !== confirmedStoreSwitch/);
});
test("reorder errors are friendly, and cart quantity editing remains available", async () => {
  const screen = await readFile(new URL("../OrdersScreen.tsx", import.meta.url), "utf8");
  const reorder = screen.slice(screen.indexOf("function RepeatOrderDialog"), screen.indexOf("function OrderDetail"));
  assert.match(reorder, /We couldn't add these items right now\. Please try again\./);
  assert.doesNotMatch(reorder, /setMessage\(reason instanceof Error \? reason\.message/);
  assert.match(reorder, /Checking availability\.\.\./);
  const cart = await readFile(new URL("../CartScreen.tsx", import.meta.url), "utf8");
  assert.match(cart, /method:\s*"PATCH"/);
  assert.match(cart, /quantity/);
});