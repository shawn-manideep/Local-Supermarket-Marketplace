import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("Home history is real, bounded, address-scoped and checked against current reorder preview", async () => {
  const home = await read("./HomeHistory.tsx");
  assert.match(home, /\/api\/customer\/orders["']/);
  assert.match(home, /homeHistorySelection\(allOrders\)/);
  assert.match(home, /\/repeat-preview\?/);
  assert.match(home, /reorderPreviewQuery\(addressId\)/);
  assert.match(home, /setRows\(\[\]\)/);
  assert.match(home, /signal: controller\.signal/);
  assert.match(home, /item\.currentUnitPrice/);
  assert.match(home, /item\.orderItemId/);
  assert.doesNotMatch(home, /productPriceSnapshot|synthetic|mock/i);
  assert.match(home, /homeRecentStore\(orders, stores\)/);
  assert.match(home, /Your last supermarket is not available at this delivery location/);
});

test("Home Buy Again keeps the original order item identity and selected owned address", async () => {
  const home = await read("./HomeHistory.tsx");
  const orders = await read("./OrdersScreen.tsx");
  assert.match(home, /setBuyAgain\(\{ orderId, itemId: item\.orderItemId \}\)/);
  assert.match(home, /initialAddressId=\{addressId\}/);
  assert.match(orders, /next\.find\(address => address\.id === initialAddressId\)/);
  assert.match(orders, /intent\.orderItemId !== orderItemId/);
  assert.match(orders, /intent\.addressId !== addressId/);
});

test("Explicit Home navigation resets to discovery while Cart continue-shopping preserves context", async () => {
  const app = await read("../App.tsx");
  const cart = await read("./CartScreen.tsx");
  const marketplace = await read("./MarketplaceScreen.tsx");
  assert.match(app, /if \(item === "home"\) \{[\s\S]*setHomeResetToken\(value => value \+ 1\)/);
  assert.match(app, /continueShopping=\{\(storeId\) => \{/);
  assert.match(app, /resetToken=\{homeResetToken\}/);
  assert.match(cart, /continueShopping\(cart\.storeId\)/);
  assert.match(marketplace, /if \(resetToken > 0\).*selectStore\(null\)/);
  assert.match(marketplace, /onBack=\{closeProduct\}/);
});

test("Cart summary identifies its store and errors do not render a false empty basket", async () => {
  const marketplace = await read("./MarketplaceScreen.tsx");
  const cart = await read("./CartScreen.tsx");
  assert.match(marketplace, /setCartStoreName\(result\.cart\?\.storeName/);
  assert.match(marketplace, /cartSummaryError &&/);
  assert.match(marketplace, /cartStoreName \|\| t\("Your supermarket basket"\)/);
  assert.match(cart, /loadFailed \? t\("Basket unavailable"\) : t\("Your basket is empty"\)/);
});

test("Product card price and action occupy independent, shrink-safe layout regions", async () => {
  const card = await read("./components/ShoppingProductCard.tsx");
  const marketplace = await read("./MarketplaceScreen.tsx");
  assert.match(card, /minWidth: 0/);
  assert.match(card, /styles\.price/);
  assert.match(card, /style=\{\[styles\.action/);
  assert.match(card, /numberOfLines=\{2\}/);
  assert.match(card, /!hasPurchasableVariant/);
  assert.match(marketplace, /No supermarkets found/);
});

test("Home store discovery uses the existing eligible-pincode response and hides stale store actions", async () => {
  const marketplace = await read("./MarketplaceScreen.tsx");
  const home = await read("./HomeHistory.tsx");
  assert.match(marketplace, /\/api\/customer\/stores\?pincode=\$\{pincode\}/);
  assert.match(marketplace, /filteredStores\.map/);
  assert.match(marketplace, /setStores\(\[\]\); setStoreDirectoryPincode\(""\)/);
  assert.match(marketplace, /storesReady=\{!loadingStores && !loadingAddresses && storeDirectoryPincode === pincode\}/);
  assert.match(home, /currentScope && storesReady && latest/);
  assert.match(marketplace, /openAddresses/);
  assert.match(marketplace, /loadStores\(\)/);
});

test("Home keeps customer privacy, explicit refresh and scoped loading rather than catalog polling", async () => {
  const home = await read("./HomeHistory.tsx");
  assert.doesNotMatch(home, /stockQuantity|stock_quantity|vendorId|commission|updatedAt|setInterval/);
  assert.match(home, /loadedAddressId === addressId/);
  assert.match(home, /homeItemAvailable/);
  assert.match(home, /Refresh recent shopping and order status/);
  assert.match(home, /currentScope \? buyAgain\?\.orderId/);
  assert.match(home, /No recent shopping to repeat/);
});