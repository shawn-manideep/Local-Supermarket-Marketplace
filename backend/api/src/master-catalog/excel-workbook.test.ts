import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type ExcelJS from "exceljs";
import { exportWorkbook, loadWorkbook, validateWorkbook, snapshotRevision, CATEGORY_HEADERS, PRODUCT_HEADERS, type CatalogSnapshot } from "./excel-workbook.js";
import { createPreviewToken, inspectXlsxArchive, MAX_UPLOAD_BYTES, PREVIEW_TTL_MS, verifyPreviewToken } from "./excel-security.js";

process.env.SESSION_SECRET = "synthetic-catalog-workbook-unit-test-signing-key";
const categoryId = randomUUID(), otherCategoryId = randomUUID(), productId = randomUUID(), otherProductId = randomUUID();
const now = new Date("2026-10-05T10:00:00Z");
function snapshot(): CatalogSnapshot {
  return {
    categories: [
      { id: categoryId, name: "Rice & Grains", isActive: true, createdAt: now, updatedAt: now },
      { id: otherCategoryId, name: "Pulses", isActive: true, createdAt: now, updatedAt: now },
    ],
    products: [
      { id: productId, masterCategoryId: categoryId, name: "Basmati Rice", brand: "Local", description: null, image: null, attributes: {}, isActive: true, createdAt: now, updatedAt: now },
      { id: otherProductId, masterCategoryId: null, name: "Pending Dal", brand: null, description: "To classify", image: null, attributes: {}, isActive: true, createdAt: now, updatedAt: now },
    ],
  };
}
async function edit(change: (w: ExcelJS.Workbook) => void, source = snapshot()) {
  const w = await loadWorkbook(await exportWorkbook(source));
  change(w);
  return Buffer.from(await w.xlsx.writeBuffer());
}
const products = (w: ExcelJS.Workbook) => w.getWorksheet("MASTER_PRODUCTS")!;
const categories = (w: ExcelJS.Workbook) => w.getWorksheet("MASTER_CATEGORIES")!;

test("export contains current canonical IDs, two editing sheets, identity metadata, no master variants or vendor fields", async () => {
  const w = await loadWorkbook(await exportWorkbook(snapshot()));
  assert.deepEqual(w.worksheets.map(s => s.name), ["MASTER_CATEGORIES", "MASTER_PRODUCTS", "CATALOG_METADATA", "INSTRUCTIONS"]);
  assert.deepEqual(categories(w).getRow(1).values, [undefined, ...CATEGORY_HEADERS]);
  assert.deepEqual(products(w).getRow(1).values, [undefined, ...PRODUCT_HEADERS]);
  assert.equal(products(w).getCell("A2").value, productId);
  assert.equal(products(w).getCell("B3").value, "");
  assert.equal(products(w).getCell("D2").value, "Basmati Rice");
  assert.ok(!JSON.stringify(PRODUCT_HEADERS).match(/price|stock|availability|sku|external code/i));
  const changed = snapshot(); changed.products[0].name = "Fresh canonical value";
  const fresh = await loadWorkbook(await exportWorkbook(changed));
  assert.equal(products(fresh).getCell("D2").value, "Fresh canonical value");
});
test("update template uses actual IDs with explicit no-creation guidance", async () => {
  const w = await loadWorkbook(await exportWorkbook(snapshot(), true));
  assert.equal(products(w).getCell("A2").value, productId);
  assert.match(String(w.getWorksheet("INSTRUCTIONS")!.getCell("A1").value), /Current-ID update template/);
});
test("unedited export round-trips with no changes and pending classification remains null", async () => {
  const plan = await validateWorkbook(await exportWorkbook(snapshot()), snapshot());
  assert.equal(plan.valid, true, JSON.stringify(plan.errors));
  assert.deepEqual(plan.summary, { added: 0, updated: 0, archived: 0, unchanged: 4 });
  assert.equal(plan.changes.length, 0);
});
test("valid edits preview canonical before/after, preserves attributes, separates archive counts", async () => {
  const bytes = await edit(w => {
    products(w).getCell("D2").value = "Premium Basmati Rice";
    products(w).getCell("H3").value = "ARCHIVED";
    categories(w).getCell("B2").value = "Rice & Cereals";
  });
  const plan = await validateWorkbook(bytes, snapshot());
  assert.equal(plan.valid, true, JSON.stringify(plan.errors));
  assert.deepEqual(plan.summary, { added: 0, updated: 2, archived: 1, unchanged: 1 });
  assert.deepEqual(plan.changes[1].fields, [{ field: "Product Name", before: "Basmati Rice", after: "Premium Basmati Rice" }]);
  assert.ok(plan.productUpdates.every(p => !("attributes" in p)));
});
for (const [name, mutate, message] of [
  ["duplicate product IDs", (w: ExcelJS.Workbook) => products(w).addRow(products(w).getRow(2).values), /appears more than once/],
  ["duplicate category IDs", (w: ExcelJS.Workbook) => categories(w).addRow(categories(w).getRow(2).values), /appears more than once/],
  ["unknown category reference", (w: ExcelJS.Workbook) => { products(w).getCell("B2").value = randomUUID(); }, /Category ID does not exist/],
  ["unknown product ID", (w: ExcelJS.Workbook) => { products(w).getCell("A2").value = randomUUID(); }, /Product ID does not exist/],
  ["unknown category ID", (w: ExcelJS.Workbook) => { categories(w).getCell("A2").value = randomUUID(); }, /Category ID does not exist/],
  ["ID changed to another real identity", (w: ExcelJS.Workbook) => { products(w).getCell("A2").value = otherProductId; }, /ID or Identity Proof was modified/],
  ["missing product name", (w: ExcelJS.Workbook) => { products(w).getCell("D2").value = ""; }, /at least 1/],
  ["missing category name", (w: ExcelJS.Workbook) => { categories(w).getCell("B2").value = ""; }, /required/],
  ["invalid product status", (w: ExcelJS.Workbook) => { products(w).getCell("H2").value = "INACTIVE"; }, /ACTIVE or ARCHIVED/],
  ["invalid category status", (w: ExcelJS.Workbook) => { categories(w).getCell("C2").value = "YES"; }, /ACTIVE or ARCHIVED/],
  ["invalid image URL", (w: ExcelJS.Workbook) => { products(w).getCell("G2").value = "not a url"; }, /url/i],
  ["formula even with cached result", (w: ExcelJS.Workbook) => { products(w).getCell("D2").value = { formula: '1+1', result: 2 }; }, /Formulas/],
  ["missing editing sheet", (w: ExcelJS.Workbook) => w.removeWorksheet("MASTER_PRODUCTS"), /Required sheet is missing/],
  ["missing required column", (w: ExcelJS.Workbook) => { products(w).getCell("H1").value = ""; }, /Required column is missing/],
  ["vendor commercial column", (w: ExcelJS.Workbook) => { products(w).getCell("J1").value = "Vendor Price"; }, /Unexpected column/],
  ["unexpected variant sheet", (w: ExcelJS.Workbook) => w.addWorksheet("MASTER_VARIANTS"), /Unexpected sheet/],
  ["tampered signed revision", (w: ExcelJS.Workbook) => { w.getWorksheet("CATALOG_METADATA")!.getCell("B3").value = "modified"; }, /Invalid catalog metadata/],
  ["row limit", (w: ExcelJS.Workbook) => { products(w).getCell("A10002").value = productId; }, /row\/column limits/],
  ["merged cells", (w: ExcelJS.Workbook) => products(w).mergeCells("D2:E2"), /Merged cells/],
  ["numeric ID cell", (w: ExcelJS.Workbook) => { products(w).getCell("A2").value = 123; }, /plain text/],
] as const) {
  test(`reject ${name} with row-level errors and an empty write plan`, async () => {
    const source = snapshot();
    const unchanged = JSON.stringify(source);
    const plan = await validateWorkbook(await edit(mutate), source);
    assert.equal(plan.valid, false);
    assert.match(plan.errors.map(e => e.message).join(" "), message);
    assert.deepEqual(plan.categoryUpdates, []);
    assert.deepEqual(plan.productUpdates, []);
    assert.equal(JSON.stringify(source), unchanged);
  });
}
test("empty workbook and corrupt non-XLSX bytes rejected without writes", async () => {
  const bytes = await edit(w => {
    categories(w).spliceRows(2, 2);
    products(w).spliceRows(2, 2);
  });
  const plan = await validateWorkbook(bytes, snapshot());
  assert.equal(plan.valid, false);
  assert.match(plan.errors[0].message, /no catalog data/);
  assert.equal((await validateWorkbook(Buffer.from("not an excel file"), snapshot())).valid, false);
});
test("canonical duplicate collision rejects rather than merging archived identities", async () => {
  const bytes = await edit(w => {
    products(w).getCell("D3").value = "basmati rice";
    products(w).getCell("E3").value = "Local";
  });
  const plan = await validateWorkbook(bytes, snapshot());
  assert.equal(plan.valid, false);
  assert.match(plan.errors.map(e => e.message).join(" "), /duplicate another canonical/);
});
test("new assignment into a category archived in the same workbook rejects", async () => {
  const bytes = await edit(w => {
    categories(w).getCell("C3").value = "ARCHIVED";
    products(w).getCell("B3").value = otherCategoryId;
  });
  assert.equal((await validateWorkbook(bytes, snapshot())).valid, false);
});
test("omitted rows are unchanged and arbitrary informational category name cannot remap identity", async () => {
  const bytes = await edit(w => {
    products(w).spliceRows(3, 1);
    products(w).getCell("C2").value = "A name alone cannot remap";
    products(w).getCell("D2").value = "Premium Rice";
  });
  const plan = await validateWorkbook(bytes, snapshot());
  assert.equal(plan.valid, true, JSON.stringify(plan.errors));
  assert.equal(plan.productUpdates[0].masterCategoryId, categoryId);
  assert.equal(plan.productUpdates.length, 1);
  assert.ok(plan.warnings.some(w => /Omitted rows/.test(w)));
});
test("concurrent catalog edits stale an exported workbook", async () => {
  const bytes = await exportWorkbook(snapshot());
  const current = snapshot(); current.products[0].description = "Changed by another admin";
  const plan = await validateWorkbook(bytes, current);
  assert.equal(plan.valid, false);
  assert.match(plan.errors[0].message, /changed since download/);
});
test("preview proof bound to exact bytes, actor, revision and expiry", async () => {
  const bytes = await exportWorkbook(snapshot());
  const revision = snapshotRevision(snapshot());
  const issued = createPreviewToken("admin", revision, bytes, 1000);
  assert.equal(verifyPreviewToken(issued.token, "admin", bytes, 2000).revision, revision);
  assert.throws(() => verifyPreviewToken(issued.token, "another-admin", bytes, 2000));
  assert.throws(() => verifyPreviewToken(issued.token, "admin", Buffer.from("different bytes"), 2000));
  assert.throws(() => verifyPreviewToken(`${issued.token}x`, "admin", bytes, 2000));
  assert.throws(() => verifyPreviewToken(issued.token, "admin", bytes, 1000 + PREVIEW_TTL_MS));
});
test("upload size and archive expansion safety limits are enforced before parsing", async () => {
  assert.throws(() => inspectXlsxArchive(Buffer.alloc(MAX_UPLOAD_BYTES + 1)));
  const bytes = await exportWorkbook(snapshot());
  const modified = Buffer.from(bytes);
  const entry = modified.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(entry > 0);
  modified.writeUInt32LE(9 * 1024 * 1024, entry + 24);
  assert.throws(() => inspectXlsxArchive(modified), /safety limits/);
});
