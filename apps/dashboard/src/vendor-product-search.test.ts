import assert from "node:assert/strict";
import { test } from "node:test";
import { filterVendorProducts } from "./vendor-product-search";
const products = [
  { id: "milk", name: "Fresh Milk", brand: "Dairy King", categoryId: "dairy" },
  { id: "rice", name: "Basmati Rice", brand: "Harvest", categoryId: "pantry" },
  { id: "flour", name: "Rice Flour", brand: "HARVEST", categoryId: "pantry" },
  { id: "eggs", name: "Eggs", brand: null, categoryId: null },
];
test("own-product search matches partial names case-insensitively", () => {
  assert.deepEqual(filterVendorProducts(products, "all", "  rIcE ").map(p => p.id), ["rice", "flour"]);
});
test("own-product search also matches partial brands", () => {
  assert.deepEqual(filterVendorProducts(products, "all", "aRv").map(p => p.id), ["rice", "flour"]);
});
test("search combines with category and uncategorized filters", () => {
  assert.deepEqual(filterVendorProducts(products, "dairy", "rice"), []);
  assert.deepEqual(filterVendorProducts(products, "pantry", "rice").map(p => p.id), ["rice", "flour"]);
  assert.deepEqual(filterVendorProducts(products, "uncategorized", "").map(p => p.id), ["eggs"]);
});
test("empty search preserves original order and references; no match returns an empty list", () => {
  const result = filterVendorProducts(products, "all", "");
  assert.deepEqual(result, products); assert.equal(result[1], products[1]);
  assert.deepEqual(filterVendorProducts(products, "all", "not-in-my-store"), []);
  assert.equal(products[0].id, "milk");
});
