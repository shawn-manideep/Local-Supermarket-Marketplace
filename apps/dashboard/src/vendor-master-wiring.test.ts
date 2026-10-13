import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("master catalog presents paginated selection, explicit confirmation, and failed-only retry", () => {
  const source = String(readFileSync(new URL("./VendorMasterCatalogPanel.tsx", import.meta.url), "utf8"));
  assert.match(source, /Select all eligible results/);
  assert.match(source, /for \(let nextPage = 2; nextPage <= totalPages/);
  assert.match(source, /Add \{selectedCount\} product/);
  assert.match(source, /Retry failed only/);
  assert.match(source, /runBulkAdd\(bulkResult\.failed\.map/);
  assert.match(source, /\/api\/vendor\/master-products\/\$\{masterProductId\}\/add-to-store/);
  assert.match(source, /existingIds\.has\(masterProductId\)/);
  assert.match(source, /Configure an exact selling quantity\/unit, price, and stock/);
});

test("both catalog surfaces place a single listing editor inline and do not scroll to it", () => {
  const master = String(readFileSync(new URL("./VendorMasterCatalogPanel.tsx", import.meta.url), "utf8"));
  const store = String(readFileSync(new URL("./CatalogManagementPanel.tsx", import.meta.url), "utf8"));
  assert.match(master, /<SellingVariantEditor token=\{token\} product=\{listing\}/);
  assert.match(master, /vendor-master-inline-editor/);
  assert.match(store, /vendor-product-inline-editor/);
  assert.match(store, /mountedVariantProductIds\.includes\(product\.id\)/);
  assert.doesNotMatch(master, /scrollIntoView/);
  assert.doesNotMatch(store, /selling variants.*scrollIntoView/s);
});

test("the selling editor saves against the vendor-local listing and preserves optimistic concurrency", () => {
  const source = String(readFileSync(new URL("./SellingVariantEditor.tsx", import.meta.url), "utf8"));
  assert.match(source, /`\/api\/vendor\/products\/\$\{product\.id\}\/variants\/batch`/);
  assert.match(source, /expectedUpdatedAt: draft\.expectedUpdatedAt/);
  assert.match(source, /Reload saved variants before trying again/);
  assert.match(source, /stockQuantity: ""/);
});
