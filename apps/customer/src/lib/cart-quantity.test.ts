import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CustomerCart } from "./api";
import { createCartQuantityController, projectCartQuantities, waitForCartQuantityWrites } from "./cart-quantity";

const cart: CustomerCart = {
  id: "cart-a", storeId: "store-a", storeName: "Store A", status: "ACTIVE", operatingStatus: "OPEN",
  subtotal: "37.65", deliveryFee: "5.00", minimumOrderValue: "0.00", total: "42.65", checkoutReady: true,
  items: [
    { id: "line-a", productId: "product-a", variantId: "variant-a", name: "Rice", description: null, imageUrl: null,
      variantName: "1 kg", quantityValue: "1", quantityUnit: "kg", quantity: 3, unitPrice: "10.05", lineSubtotal: "30.15", availability: true, purchasable: true },
    { id: "line-b", productId: "product-a", variantId: "variant-b", name: "Rice", description: null, imageUrl: null,
      variantName: "500 g", quantityValue: "500", quantityUnit: "g", quantity: 1, unitPrice: "7.50", lineSubtotal: "7.50", availability: true, purchasable: true },
  ],
};
function fixture(options: { fail?: boolean; delayed?: boolean } = {}) {
  let persisted: CustomerCart | null = structuredClone(cart);
  const changes: Array<CustomerCart | null> = [];
  const writes: Array<[string, number]> = [];
  const errors: unknown[] = [];
  let release = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  const controller = createCartQuantityController({
    write: async (id, quantity) => {
      writes.push([id, quantity]);
      if (options.delayed && writes.length === 1) await hold;
      if (options.fail) throw new Error("Synthetic write failure");
      persisted = projectCartQuantities(persisted, new Map([[id, quantity]]));
      return structuredClone(persisted);
    },
    read: async () => structuredClone(persisted),
    onChange: value => changes.push(value),
    onPending: () => {},
    onError: error => errors.push(error),
  });
  controller.reset(persisted);
  return { controller, changes, writes, errors, release, persisted: () => persisted };
}
test("minus above one decrements exactly one and updates exact-money totals immediately", async () => {
  const f = fixture();
  f.controller.adjust("line-a", -1);
  const visible = f.changes.at(-1)!;
  assert.equal(visible!.items[0]!.quantity, 2);
  assert.equal(visible!.subtotal, "27.60"); assert.equal(visible!.total, "32.60");
  await f.controller.settled();
  assert.equal(f.persisted()!.items[0]!.quantity, 2);
});
test("minus at one persists removal of only the exact variant and retains store/product identity", async () => {
  const f = fixture();
  f.controller.adjust("line-b", -1);
  assert.deepEqual(f.changes.at(-1)!.items.map(item => item.variantId), ["variant-a"]);
  assert.equal(f.changes.at(-1)!.storeId, "store-a");
  assert.equal(f.changes.at(-1)!.items[0]!.productId, "product-a");
  await f.controller.settled();
  assert.deepEqual(f.writes, [["line-b", 0]]);
  assert.equal(f.persisted()!.subtotal, "30.15"); assert.equal(f.persisted()!.total, "35.15");
});
test("removing the last item publishes and persists the existing null empty-cart state", async () => {
  const f = fixture();
  f.controller.remove("line-a"); f.controller.remove("line-b");
  assert.equal(f.changes.at(-1), null);
  await f.controller.settled();
  assert.equal(f.persisted(), null);
  assert.equal(f.changes.at(-1), null);
});
test("rapid repeated minus reaches zero, never negatives, duplicate writes or resurrection", async () => {
  const f = fixture({ delayed: true });
  for (let n = 0; n < 8; n++) f.controller.adjust("line-a", -1);
  f.controller.adjust("line-a", 1);
  assert.deepEqual(f.changes.at(-1)!.items.map(item => item.id), ["line-b"]);
  f.release(); await f.controller.settled();
  assert.deepEqual(f.writes, [["line-a", 2], ["line-a", 0]]);
  assert.deepEqual(f.persisted()!.items.map(item => item.id), ["line-b"]);
});
test("different-line writes serialize and older responses do not replace newer optimistic totals", async () => {
  const f = fixture({ delayed: true });
  f.controller.adjust("line-a", -1); f.controller.adjust("line-b", -1);
  assert.equal(f.changes.at(-1)!.total, "25.10");
  f.release(); await f.controller.settled();
  assert.equal(f.changes.at(-1)!.total, "25.10");
  assert.deepEqual(f.writes, [["line-a", 2], ["line-b", 0]]);
  assert.ok(f.changes.slice(2).every(value => value!.items.every(item => item.id !== "line-b")));
});
test("navigation waits for queued persisted removals before reading the cart again", async () => {
  const f = fixture({ delayed: true });
  f.controller.remove("line-a"); f.controller.remove("line-b");
  let done = false;
  const navigation = waitForCartQuantityWrites().then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false);
  f.release(); await navigation;
  assert.equal(f.persisted(), null);
});
test("failed update reloads authoritative quantities and reports failure instead of keeping stale optimism", async () => {
  const f = fixture({ fail: true });
  f.controller.remove("line-b");
  await f.controller.settled();
  assert.equal(f.changes.at(-1)!.items.length, 2);
  assert.equal(f.changes.at(-1)!.total, cart.total);
  assert.equal(f.errors.length, 1);
});
test("unknown line identities never mutate another product or cart", async () => {
  const f = fixture();
  f.controller.remove("foreign-line"); f.controller.adjust("variant-a", -1);
  await f.controller.settled();
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.persisted(), cart);
});
test("Home category tiles are removed while category filters and Customer navigation remain", async () => {
  const home = await readFile(new URL("../MarketplaceScreen.tsx", import.meta.url), "utf8");
  const screen = await readFile(new URL("../CartScreen.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(home, /Shop by Categor/);
  assert.match(home, /categories\.map/); assert.match(home, /setCategoryId/);
  assert.match(screen, /min=\{0\}/); assert.match(screen, /quantity\(item\.id, -1\)/);
  assert.match(app, /item === "orders" \? "Reorder"/);
});
