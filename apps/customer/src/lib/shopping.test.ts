import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatVariantName } from "@workspace/validation/variant-formatting";
import type { CustomerProduct, CustomerProductVariant } from "./api";
import {
  activeVariants, canPurchaseVariant, cartItemInput, discoveryQuery, initialVariantId,
  productAvailabilityLabel, productPriceLabel, shoppingError, variantAvailabilityLabel,
} from "./shopping";

const option: CustomerProductVariant = {
  id: "variant-a", productId: "product-a", name: "1 kg", quantityValue: "1.000", quantityUnit: "kg",
  price: "75.50", availability: true, isActive: true, sortOrder: 0, purchasable: true,
};
const product: CustomerProduct = {
  id: "product-a", storeId: "store-a", categoryId: null, categoryName: null, name: "Rice",
  brand: "Brand", description: null, imageUrl: null, price: "999.00",
  availability: true, purchasable: true, variants: [option],
};

test("global search needs no category for rice, milk, eggs, or brand terms", () => {
  for (const term of ["rice", "milk", "eggs", "amul"]) {
    const query = new URLSearchParams(discoveryQuery("560001", ` ${term} `));
    assert.equal(query.get("search"), term);
    assert.equal(query.has("categoryId"), false);
    assert.equal(query.get("pincode"), "560001");
    assert.equal(query.get("page"), "1");
  }
});

test("categories are optional, support category-only browsing, and preserve pagination", () => {
  const query = new URLSearchParams(discoveryQuery("560001", "", "category-a", 2));
  assert.equal(query.get("categoryId"), "category-a");
  assert.equal(query.has("search"), false);
  assert.equal(query.get("page"), "2");
  assert.equal(query.get("pageSize"), "24");
});

test("single available option is selected automatically; multiple options require deliberate selection", () => {
  assert.equal(initialVariantId(product), option.id);
  assert.equal(initialVariantId({ ...product, variants: [option, { ...option, id: "variant-b" }] }), "");
  assert.equal(initialVariantId({ ...product, variants: [option, { ...option, id: "variant-b", purchasable: false }] }), "");
  assert.equal(initialVariantId({ ...product, purchasable: false }), "");
});

test("inactive options are omitted and active options retain server-managed order", () => {
  assert.deepEqual(activeVariants({ ...product, variants: [
    { ...option, id: "later", sortOrder: 2 }, { ...option, id: "inactive", isActive: false }, option,
  ] }).map(item => item.id), ["variant-a", "later"]);
});

test("chosen variant and order quantity are sent to cart without client-owned prices or stock", () => {
  const second = { ...option, id: "variant-b", quantityValue: "2", price: "145.00" };
  const input = cartItemInput({ ...product, variants: [option, second] }, second, 3);
  assert.deepEqual(input, { productId: product.id, variantId: second.id, quantity: 3, confirmStoreSwitch: false });
  assert.equal(second.quantityValue, "2");
  assert.equal(Object.hasOwn(input, "price"), false);
  assert.equal(Object.hasOwn(input, "stockQuantity"), false);
  assert.throws(() => cartItemInput(product, second, 1), /unavailable/);
  assert.throws(() => cartItemInput(product, option, 0), /quantity/);
});

test("zero-stock, unavailable, inactive, and zero-price options cannot be purchased", () => {
  for (const variant of [
    { ...option, purchasable: false }, { ...option, availability: false },
    { ...option, isActive: false }, { ...option, price: "0.00" },
  ]) {
    assert.equal(canPurchaseVariant(product, variant), false);
    assert.throws(() => cartItemInput({ ...product, variants: [variant] }, variant, 1), /unavailable/);
  }
  assert.equal(variantAvailabilityLabel(product, { ...option, purchasable: false }), "Out of stock");
  assert.equal(variantAvailabilityLabel(product, { ...option, availability: false }), "Currently unavailable");
  assert.equal(productAvailabilityLabel({ ...product, availability: false }), "Currently unavailable");
});

test("prices come from current store variants, never a stale listing price", () => {
  assert.equal(productPriceLabel(product), "₹75.50");
  assert.equal(productPriceLabel(product, { ...option, price: "99.00" }), "₹99");
  const second = { ...option, id: "variant-b", price: "40.00", purchasable: false };
  assert.equal(productPriceLabel({ ...product, variants: [option, second] }), "From ₹75.50");
  assert.equal(productPriceLabel({ ...product, variants: [] }), "No selling options");
  assert.equal(formatVariantName("500.000", "g"), "500 g");
});

test("store switching is explicit and same-store additions preserve separate product identities", () => {
  assert.equal(cartItemInput(product, option, 1).confirmStoreSwitch, false);
  assert.equal(cartItemInput(product, option, 1, true).confirmStoreSwitch, true);
  const nextOption = { ...option, id: "next-variant", productId: "next-product" };
  const nextProduct = { ...product, id: "next-product", variants: [nextOption] };
  assert.equal(nextProduct.storeId, product.storeId);
  assert.notEqual(cartItemInput(nextProduct, nextOption, 1).productId, cartItemInput(product, option, 1).productId);
});

test("unknown errors are sanitized while stock and delivery failures remain actionable", () => {
  assert.equal(shoppingError(new Error("database password=private diagnostic")), "We couldn't complete that request. Please try again.");
  assert.match(shoppingError(new Error("Requested quantity exceeds available stock")), /Try fewer/);
  assert.match(shoppingError(new Error("Store not available for this pincode")), /delivery address/);
});

test("customer UI has contextual cart access, retains shopping state, and exposes no vendor controls", async () => {
  const screen = await readFile(new URL("../MarketplaceScreen.tsx", import.meta.url), "utf8");
  const app = await readFile(new URL("../../App.tsx", import.meta.url), "utf8");
  const card = await readFile(new URL("../components/ShoppingProductCard.tsx", import.meta.url), "utf8");
  assert.match(app, /const navItems: Array<"home" \| "orders" \| "account">/);
  assert.match(app, /display: screen === "home" \? "flex" : "none"/);
  assert.match(screen, /Go to Cart/);
  assert.match(screen, /Back to search results/);
  assert.match(screen, /storeCatalogGeneration/);
  assert.doesNotMatch(screen + card, /stockQuantity|\.sku|\.externalCode|masterProductId|\/api\/vendor\/|\/api\/admin\//);
  assert.match(card, /variants\.length === 1/);
});