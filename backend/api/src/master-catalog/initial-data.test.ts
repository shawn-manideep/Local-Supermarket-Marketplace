import assert from "node:assert/strict";
import test from "node:test";
import { canonicalIdentity, normalizeIdentityText } from "./duplicate-review.js";
import {
  INITIAL_MASTER_CATEGORY_NAMES,
  INITIAL_MASTER_PRODUCTS,
} from "./initial-data.js";

const requestedCategories = [
  "Rice & Grains",
  "Atta & Flours",
  "Dals & Pulses",
  "Cooking Oils & Ghee",
  "Spices & Masalas",
  "Salt & Sugar",
  "Dairy & Milk Products",
  "Eggs",
  "Fruits",
  "Vegetables",
  "Biscuits & Cookies",
  "Bakery",
  "Snacks",
  "Chocolates & Sweets",
  "Beverages",
  "Tea & Coffee",
  "Breakfast & Cereals",
  "Packaged Foods",
  "Noodles & Pasta",
  "Sauces & Spreads",
  "Pickles",
  "Baby Food",
  "Personal Care",
  "Household Cleaning",
  "Home & Kitchen Essentials",
];

const requiredCoreProducts = [
  "Sona Masuri Rice",
  "Basmati Rice",
  "Brown Rice",
  "Idli Rice",
  "Ponni Rice",
  "Raw Rice",
  "Boiled Rice",
  "Broken Rice",
  "Wheat Atta",
  "Maida",
  "Rava",
  "Sooji",
  "Besan",
  "Rice Flour",
  "Multigrain Atta",
  "Corn Flour",
  "Toor Dal",
  "Moong Dal",
  "Masoor Dal",
  "Chana Dal",
  "Urad Dal",
  "Kabuli Chana",
  "Rajma",
  "Black Chana",
  "Sunflower Oil",
  "Groundnut Oil",
  "Rice Bran Oil",
  "Mustard Oil",
  "Coconut Oil",
  "Sesame Oil",
  "Ghee",
  "Full Cream Milk",
  "Toned Milk",
  "Double Toned Milk",
  "Curd",
  "Buttermilk",
  "Paneer",
  "Cheese",
  "Butter",
  "Regular White Eggs",
  "Brown Eggs",
  "Country Eggs",
  "Omega Eggs",
];

test("initial catalog dataset contains the exact 25 requested master categories", () => {
  assert.deepEqual(INITIAL_MASTER_CATEGORY_NAMES, requestedCategories);
  assert.equal(new Set(INITIAL_MASTER_CATEGORY_NAMES.map(normalizeIdentityText)).size, 25);
});

test("initial catalog covers each exact required core product and realistic families across all categories", () => {
  const names = new Set(INITIAL_MASTER_PRODUCTS.map((product) => product.name));
  for (const name of requiredCoreProducts) assert.ok(names.has(name), `Missing core family: ${name}`);

  const representedCategories = new Set(INITIAL_MASTER_PRODUCTS.map((product) => product.categoryName));
  assert.deepEqual(
    [...representedCategories].sort(),
    [...INITIAL_MASTER_CATEGORY_NAMES].sort(),
  );
  assert.ok(INITIAL_MASTER_PRODUCTS.length >= 180 && INITIAL_MASTER_PRODUCTS.length <= 200);
  assert.equal(INITIAL_MASTER_PRODUCTS.length, 181);

  const coreCategories = new Set([
    "Rice & Grains",
    "Atta & Flours",
    "Dals & Pulses",
    "Cooking Oils & Ghee",
    "Dairy & Milk Products",
    "Eggs",
  ]);
  for (const categoryName of INITIAL_MASTER_CATEGORY_NAMES.filter((name) => !coreCategories.has(name))) {
    const count = INITIAL_MASTER_PRODUCTS.filter((product) => product.categoryName === categoryName).length;
    assert.ok(count >= 5 && count <= 10, `${categoryName} has ${count} representative families`);
  }
});

test("seed family identities are unique after the canonical name, brand, and attributes normalization", () => {
  const identities = INITIAL_MASTER_PRODUCTS.map((product) => canonicalIdentity({
    masterCategoryId: product.categoryName,
    name: product.name,
    brand: product.brand,
    attributes: product.attributes,
  }));
  assert.equal(new Set(identities).size, identities.length);

  const genericAndBrandedMilk = INITIAL_MASTER_PRODUCTS.filter((product) =>
    product.name === "Full Cream Milk");
  assert.ok(genericAndBrandedMilk.some((product) => product.brand === null));
  assert.ok(genericAndBrandedMilk.some((product) => product.brand === "Amul"));
});

test("seed families contain no retail pack sizes or vendor commercial fields", () => {
  const forbiddenPackSize = /\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|pieces?|packs?|dozen|bottles?|boxes?)\b/i;
  const allowedFields = ["attributes", "brand", "categoryName", "description", "image", "name"];

  for (const product of INITIAL_MASTER_PRODUCTS) {
    assert.deepEqual(Object.keys(product).sort(), allowedFields);
    assert.equal(product.image, null);
    assert.deepEqual(product.attributes, {});
    assert.equal(forbiddenPackSize.test(product.name), false, product.name);
    assert.equal(product.brand === null || [
      "Amul",
      "Mother Dairy",
      "Tata",
      "Aashirvaad",
    ].includes(product.brand), true);
  }
});

test("branded families support brand search and descriptions provide neutral detail-search terms", () => {
  const brandedFamilies = INITIAL_MASTER_PRODUCTS
    .filter((product) => product.brand !== null)
    .map((product) => `${product.brand}:${product.name}`)
    .sort();
  assert.deepEqual(brandedFamilies, [
    "Aashirvaad:Wheat Atta",
    "Amul:Butter",
    "Amul:Curd",
    "Amul:Full Cream Milk",
    "Mother Dairy:Toned Milk",
    "Tata:Iodised Salt",
  ]);

  const basmati = INITIAL_MASTER_PRODUCTS.find((product) => product.name === "Basmati Rice")!;
  assert.match(basmati.description, /aromatic/i);
  assert.match(basmati.description, /biryani/i);
});