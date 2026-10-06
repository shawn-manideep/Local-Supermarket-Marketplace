import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const source = async (file: string) => (await readFile(new URL(`../../../../apps/dashboard/src/${file}`, import.meta.url))).toString("utf8");
test("Vendor navigation gates only Catalog and preserves Orders/Profile/account/logout", async () => {
  const panel = await source("VendorStorePanel.tsx");
  assert.match(panel, /if \(!documentResponse.canManageCatalog\) setCurrentTab\("documents"\)/);
  assert.match(panel, /setCurrentTab\(documentStatus\?\.canManageCatalog \? "catalog" : "documents"\)/);
  assert.match(panel, /currentTab === "catalog" && documentStatus\?\.canManageCatalog/);
  for (const label of ["Orders", "Store Profile", "Account & Settings", "Documents"]) assert.ok(panel.includes(label));
  assert.match(panel, /onSignOut=\{onSignOut\}/);
});
test("Catalog chooser and new-product duplicate review retain existing editing and variant flows", async () => {
  const catalog = await source("CatalogManagementPanel.tsx");
  for (const label of ["+ Add Product", "Select from Master Catalog", "Add New Product"]) assert.ok(catalog.includes(label));
  assert.match(catalog, /<SellingVariantEditor/);
  assert.match(catalog, /<VendorMasterCatalogPanel/);
  assert.match(catalog, /<VendorNewProductPanel/);
  const newProduct = await source("VendorNewProductPanel.tsx");
  for (const label of ["Similar product found in Master Catalog.", "Use Existing Product", "Continue with New Product",
    "Category not available? Request a new category"]) assert.ok(newProduct.includes(label));
  assert.match(newProduct, /confirmSimilar/);
  assert.match(newProduct, /exactIdentity/);
});
test("Documents use bearer-authenticated bytes, safe blob view, replacement and no deletion", async () => {
  const panel = await source("VendorDocumentsPanel.tsx");
  assert.match(panel, /apiAuthorizationHeaders\(token/);
  assert.match(panel, /method: "PUT"/);
  assert.match(panel, /body: file/);
  assert.match(panel, /URL.createObjectURL\(blob\)/);
  assert.match(panel, /noopener noreferrer/);
  assert.match(panel, /URL.revokeObjectURL/);
  assert.match(panel, /Replace/);
  assert.doesNotMatch(panel, /method: "DELETE"|object_ref|storage.googleapis.com/);
});
test("Search and category controls share equal tracks/dimensions with responsive overrides", async () => {
  const css = await source("index.css");
  const scoped = css.slice(css.indexOf("/* Vendor catalog search controls"));
  assert.match(scoped, /\.vendor-master-search[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(scoped, /\.vendor-master-search input,\s*\.vendor-master-search select\s*\{[^}]*border-radius: 10px[^}]*height: 44px[^}]*width: 100%/s);
  assert.match(scoped, /@media \(max-width: 600px\)/);
});
