import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isForegroundAppActive } from "./foreground-policy";

test("customer refreshes only while the native app or visible browser tab is active", () => {
  assert.equal(isForegroundAppActive("active", "web", true), true);
  assert.equal(isForegroundAppActive("active", "web", false), false);
  assert.equal(isForegroundAppActive("background", "web", true), true);
  assert.equal(isForegroundAppActive("active", "ios"), true);
  assert.equal(isForegroundAppActive("inactive", "ios"), false);
});

test("Customer order, cart, and product refreshes are bounded and recover on foreground", async () => {
  const [orders, cart, home] = await Promise.all([
    readFile(new URL("../OrdersScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../CartScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../MarketplaceScreen.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(orders, /setInterval\(refresh, 12_000\)/);
  assert.match(orders, /setInterval\(\(\) => \{ void refreshStatus\(\); \}, 12_000\)/);
  assert.match(orders, /subscribeToCustomerForeground/);
  assert.match(cart, /setInterval\(\(\) => \{ if \(isCustomerAppForeground\(\)\) void refreshPrices\(\); \}, 12_000\)/);
  assert.match(cart, /quantityController\.current!\.version\(\) !== version/);
  assert.match(cart, /quantityController\.current!\.reset\(fresh\)/);
  assert.match(home, /setInterval\(refresh, 12_000\)/);
  assert.match(home, /subscribeToCustomerForeground/);
  assert.match(home, /setInterval\(refresh, 15_000\)/);
});
