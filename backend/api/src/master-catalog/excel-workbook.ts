import ExcelJS from "exceljs";
import type { masterCategories, masterProducts } from "@workspace/db";
import { masterCategoryUpdateSchema, masterProductAdminUpdateSchema } from "@workspace/validation";
import { HttpError } from "../http.js";
import { canonicalIdentity, normalizeIdentityText } from "./duplicate-review.js";
import { digest, equalProof, identityProof, inspectXlsxArchive, MAX_CATALOG_ROWS, revisionProof } from "./excel-security.js";

export type CategoryRow = typeof masterCategories.$inferSelect;
export type ProductRow = typeof masterProducts.$inferSelect;
export type CatalogSnapshot = { categories: CategoryRow[]; products: ProductRow[] };
export type ImportError = { sheet: string; row: number; column: string; message: string };
export type ImportSummary = { added: number; updated: number; archived: number; unchanged: number };
export type ImportChange = {
  sheet: string; row: number; id: string; name: string;
  fields: Array<{ field: string; before: string | null; after: string | null }>;
};
type CategoryUpdate = { id: string; name: string; isActive: boolean };
type ProductUpdate = {
  id: string; masterCategoryId: string | null; name: string; brand: string | null;
  description: string | null; image: string | null; isActive: boolean;
};
export type ImportPlan = {
  valid: boolean; errors: ImportError[]; warnings: string[]; summary: ImportSummary;
  changes: ImportChange[]; categoryUpdates: CategoryUpdate[]; productUpdates: ProductUpdate[];
  revision: string;
};

export const CATEGORY_HEADERS = ["Master Category ID", "Category Name", "Status", "Identity Proof"];
export const PRODUCT_HEADERS = [
  "Master Product ID", "Category ID", "Category Name", "Product Name", "Brand",
  "Description", "Image URL", "Status", "Identity Proof",
];
const SHEETS = ["MASTER_CATEGORIES", "MASTER_PRODUCTS", "CATALOG_METADATA", "INSTRUCTIONS"];

export function snapshotRevision(snapshot: CatalogSnapshot) {
  return digest(JSON.stringify({
    categories: [...snapshot.categories].sort((a, b) => a.id.localeCompare(b.id)),
    products: [...snapshot.products].sort((a, b) => a.id.localeCompare(b.id)).map(p => ({
      ...p, attributes: Object.fromEntries(Object.entries(p.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    })),
  }));
}

function styleSheet(sheet: ExcelJS.Worksheet, headers: string[]) {
  sheet.addRow(headers);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  sheet.getRow(1).font = { name: "Inter", bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
  headers.forEach((header, i) => {
    sheet.getColumn(i + 1).width = header.includes("ID") || header.includes("Proof") ? 42 : 28;
    sheet.getColumn(i + 1).numFmt = "@";
  });
}

export async function exportWorkbook(snapshot: CatalogSnapshot, template = false) {
  if (snapshot.products.length > MAX_CATALOG_ROWS || snapshot.categories.length > MAX_CATALOG_ROWS) {
    throw new HttpError(413, "Catalog exceeds the supported 10,000 records per sheet");
  }
  const revision = snapshotRevision(snapshot);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Local Basket";
  workbook.created = new Date();
  const categories = workbook.addWorksheet("MASTER_CATEGORIES");
  styleSheet(categories, CATEGORY_HEADERS);
  const products = workbook.addWorksheet("MASTER_PRODUCTS");
  styleSheet(products, PRODUCT_HEADERS);
  const categoryNames = new Map(snapshot.categories.map(c => [c.id, c.name]));
  for (const category of snapshot.categories) {
    categories.addRow([category.id, category.name, category.isActive ? "ACTIVE" : "ARCHIVED",
      identityProof(categories.name, category.id, revision)]);
  }
  for (const product of snapshot.products) {
    products.addRow([product.id, product.masterCategoryId ?? "", categoryNames.get(product.masterCategoryId ?? "") ?? "",
      product.name, product.brand ?? "", product.description ?? "", product.image ?? "",
      product.isActive ? "ACTIVE" : "ARCHIVED", identityProof(products.name, product.id, revision)]);
  }
  const metadata = workbook.addWorksheet("CATALOG_METADATA");
  styleSheet(metadata, ["Key", "Value"]);
  metadata.addRows([["Format Version", "1"], ["Catalog Revision", revision], ["Revision Proof", revisionProof(revision)]]);
  const instructions = workbook.addWorksheet("INSTRUCTIONS");
  instructions.getColumn(1).width = 110;
  [
    template ? "Current-ID update template — edit existing rows; not a blank creation template." : "Current database Master Catalog — updates only.",
    "Keep all IDs, Identity Proof cells, CATALOG_METADATA and required headers unchanged.",
    "Edit canonical fields only. ACTIVE and ARCHIVED are the supported status values.",
    "Category Name in MASTER_PRODUCTS is informational; use Category ID to assign a category.",
    "Blank Category ID means pending classification. Blank Brand, Description or Image URL clears that optional field.",
    "Missing rows are left unchanged; they are never deleted or archived automatically.",
    "No new records through Excel. Use the existing Admin forms for reviewed creation.",
    "Discovery attributes are preserved unchanged. Selling variants are vendor-owned; there is no master variant sheet.",
    "No vendor prices, stock, availability, SKUs or inventory may be imported.",
    "Upload, validate, inspect before/after changes, then explicitly confirm Apply Changes.",
    "If any canonical catalog record changes after download, download fresh data and repeat your edits.",
    "Macros, formulas, hyperlinks/external relationships and non-text cell values are not accepted.",
    "Maximum upload: 2 MiB. Maximum data rows per sheet: 10,000. Preview expires after 10 minutes.",
    "All workbook changes apply atomically. Historical orders and snapshots remain unchanged.",
  ].forEach(text => instructions.addRow([text]));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function loadWorkbook(bytes: Buffer) {
  inspectXlsxArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
  } catch {
    throw new HttpError(400, "Unable to parse the Excel workbook");
  }
  return workbook;
}

export async function validateWorkbook(bytes: Buffer, snapshot: CatalogSnapshot): Promise<ImportPlan> {
  const plan: ImportPlan = {
    valid: false, errors: [], warnings: [], summary: { added: 0, updated: 0, archived: 0, unchanged: 0 },
    changes: [], categoryUpdates: [], productUpdates: [], revision: snapshotRevision(snapshot),
  };
  const error = (sheet: string, row: number, column: string, message: string) => {
    if (plan.errors.length < 500) plan.errors.push({ sheet, row, column, message });
  };
  let workbook: ExcelJS.Workbook;
  try {
    workbook = await loadWorkbook(bytes);
  } catch (reason) {
    if (reason instanceof HttpError && reason.statusCode === 413) throw reason;
    error("WORKBOOK", 0, "", reason instanceof Error ? reason.message : "Invalid workbook");
    return plan;
  }
  for (const sheet of workbook.worksheets) {
    if (!SHEETS.includes(sheet.name)) error(sheet.name, 0, "", "Unexpected sheet; vendor commercial data and extra sheets are not allowed.");
    if (sheet.rowCount > MAX_CATALOG_ROWS + 1 || sheet.columnCount > 20) {
      error(sheet.name, 0, "", "Sheet exceeds row/column limits");
      continue;
    }
    if ((sheet.model.merges ?? []).length) error(sheet.name, 0, "", "Merged cells are not supported");
    sheet.eachRow(row => row.eachCell(cell => {
      if (typeof cell.value === "object" && cell.value !== null) {
        error(sheet.name, Number(cell.row), String(cell.col), "Use plain text cells. Formulas, errors, rich text and hyperlinks are not accepted.");
      } else if (cell.value !== null && typeof cell.value !== "string") {
        error(sheet.name, Number(cell.row), String(cell.col), "Cell must be plain text");
      }
    }));
  }
  const columns = (sheetName: string, headers: string[]) => {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) { error(sheetName, 0, "", "Required sheet is missing"); return null; }
    const map = new Map<string, number>();
    sheet.getRow(1).eachCell(cell => {
      const name = typeof cell.value === "string" ? cell.value.trim() : "";
      if (!headers.includes(name)) error(sheetName, 1, String(cell.col), `Unexpected column ${name || "(blank)"}`);
      if (map.has(name)) error(sheetName, 1, name, "Duplicate column");
      map.set(name, Number(cell.col));
    });
    for (const name of headers) if (!map.has(name)) error(sheetName, 1, name, "Required column is missing");
    return { sheet, map };
  };
  const cat = columns("MASTER_CATEGORIES", CATEGORY_HEADERS);
  const prod = columns("MASTER_PRODUCTS", PRODUCT_HEADERS);
  const meta = columns("CATALOG_METADATA", ["Key", "Value"]);
  if (plan.errors.length || !cat || !prod || !meta) return plan;
  const text = (row: ExcelJS.Row, map: Map<string, number>, name: string) => {
    const value = row.getCell(map.get(name)!).value;
    return typeof value === "string" ? value.trim() : "";
  };
  const metadata = new Map<string, string>();
  meta.sheet.eachRow((row, i) => {
    if (i === 1) return;
    const key = text(row, meta.map, "Key");
    if (metadata.has(key)) error(meta.sheet.name, i, "Key", "Duplicate metadata key");
    metadata.set(key, text(row, meta.map, "Value"));
  });
  const revision = metadata.get("Catalog Revision") ?? "";
  if (metadata.get("Format Version") !== "1" ||
      !equalProof(revisionProof(revision), metadata.get("Revision Proof") ?? "")) {
    error(meta.sheet.name, 0, "", "Invalid catalog metadata. Start from a current catalog download.");
  }
  if (revision !== plan.revision) error(meta.sheet.name, 0, "", "Catalog changed since download. Download the current catalog and repeat your edits.");
  if (plan.errors.length) return plan;
  const categories = new Map(snapshot.categories.map(c => [c.id, { ...c }]));
  const products = new Map(snapshot.products.map(p => [p.id, { ...p }]));
  const seenCategories = new Set<string>();
  const seenProducts = new Set<string>();
  const status = (value: string, sheet: string, row: number) => {
    if (!["ACTIVE", "ARCHIVED"].includes(value)) error(sheet, row, "Status", "Status must be ACTIVE or ARCHIVED");
    return value === "ACTIVE";
  };
  const recordChange = (
    sheet: string, row: number, id: string, name: string, before: Record<string, unknown>, after: Record<string, unknown>,
    labels: Record<string, string>,
  ) => {
    const fields = Object.keys(after).filter(key => after[key] !== before[key]).map(key => ({
      field: labels[key] ?? key,
      before: before[key] === null ? null : String(key === "isActive" ? before[key] ? "ACTIVE" : "ARCHIVED" : before[key]),
      after: after[key] === null ? null : String(key === "isActive" ? after[key] ? "ACTIVE" : "ARCHIVED" : after[key]),
    }));
    if (!fields.length) { plan.summary.unchanged++; return false; }
    if (before.isActive === true && after.isActive === false) plan.summary.archived++;
    else plan.summary.updated++;
    plan.changes.push({ sheet, row, id, name, fields });
    return true;
  };
  cat.sheet.eachRow((row, i) => {
    if (i === 1 || !row.hasValues) return;
    const id = text(row, cat.map, "Master Category ID");
    const existing = categories.get(id);
    if (seenCategories.has(id)) error(cat.sheet.name, i, "Master Category ID", "Master Category ID appears more than once");
    seenCategories.add(id);
    if (!existing) { error(cat.sheet.name, i, "Master Category ID", "Category ID does not exist. IDs cannot be changed; Excel creation is not supported."); return; }
    if (!equalProof(identityProof(cat.sheet.name, id, revision), text(row, cat.map, "Identity Proof"))) {
      error(cat.sheet.name, i, "Master Category ID", "ID or Identity Proof was modified"); return;
    }
    const name = text(row, cat.map, "Category Name");
    const parsed = masterCategoryUpdateSchema.safeParse({ name });
    if (!parsed.success) error(cat.sheet.name, i, "Category Name", "Category Name is required and must be at most 200 characters");
    const isActive = status(text(row, cat.map, "Status"), cat.sheet.name, i);
    const update = { name, isActive };
    if (recordChange(cat.sheet.name, i, id, existing.name, existing, update, { name: "Category Name", isActive: "Status" })) {
      plan.categoryUpdates.push({ id, ...update });
    }
    categories.set(id, { ...existing, ...update });
  });
  prod.sheet.eachRow((row, i) => {
    if (i === 1 || !row.hasValues) return;
    const id = text(row, prod.map, "Master Product ID");
    const existing = products.get(id);
    if (seenProducts.has(id)) error(prod.sheet.name, i, "Master Product ID", "Master Product ID appears more than once");
    seenProducts.add(id);
    if (!existing) { error(prod.sheet.name, i, "Master Product ID", "Product ID does not exist. IDs cannot be changed; Excel creation is not supported."); return; }
    if (!equalProof(identityProof(prod.sheet.name, id, revision), text(row, prod.map, "Identity Proof"))) {
      error(prod.sheet.name, i, "Master Product ID", "ID or Identity Proof was modified"); return;
    }
    const masterCategoryId = text(row, prod.map, "Category ID") || null;
    const update = {
      masterCategoryId, name: text(row, prod.map, "Product Name"),
      brand: text(row, prod.map, "Brand") || null, description: text(row, prod.map, "Description") || null,
      image: text(row, prod.map, "Image URL") || null,
      isActive: status(text(row, prod.map, "Status"), prod.sheet.name, i),
    };
    const { isActive: _status, ...canonical } = update;
    const parsed = masterProductAdminUpdateSchema.safeParse(canonical);
    if (!parsed.success) {
      const labels: Record<string, string> = { name: "Product Name", masterCategoryId: "Category ID", brand: "Brand", image: "Image URL", description: "Description" };
      for (const issue of parsed.error.issues) error(prod.sheet.name, i, labels[String(issue.path[0])] ?? "", issue.message);
    }
    const category = masterCategoryId ? categories.get(masterCategoryId) : undefined;
    if (masterCategoryId && !category) error(prod.sheet.name, i, "Category ID", "Category ID does not exist");
    if (category && !category.isActive && masterCategoryId !== existing.masterCategoryId) {
      error(prod.sheet.name, i, "Category ID", "A new category assignment must reference an ACTIVE category");
    }
    if (recordChange(prod.sheet.name, i, id, existing.name, existing, update, {
      masterCategoryId: "Category ID", name: "Product Name", brand: "Brand", description: "Description", image: "Image URL", isActive: "Status",
    })) plan.productUpdates.push({ id, ...update });
    products.set(id, { ...existing, ...update });
  });
  if (seenCategories.size + seenProducts.size === 0) error("WORKBOOK", 0, "", "Workbook contains no catalog data rows");
  // Compare proposed identities against the entire catalog, including omitted and
  // archived records. Existing duplicates are not cleaned up by this feature.
  const identities = new Map<string, string[]>();
  for (const product of products.values()) {
    const key = canonicalIdentity(product);
    identities.set(key, [...(identities.get(key) ?? []), product.id]);
  }
  for (const update of plan.productUpdates) {
    const original = snapshot.products.find(p => p.id === update.id)!;
    const proposed = products.get(update.id)!;
    if (canonicalIdentity(original) !== canonicalIdentity(proposed) &&
        identities.get(canonicalIdentity(proposed))!.length > 1) {
      const change = plan.changes.find(c => c.id === update.id)!;
      error("MASTER_PRODUCTS", change.row, "Product Name", "This edit would duplicate another canonical product, including archived products. No merging is performed.");
    }
  }
  for (const update of plan.categoryUpdates) {
    const original = snapshot.categories.find(c => c.id === update.id)!;
    if (normalizeIdentityText(original.name) !== normalizeIdentityText(update.name) &&
        [...categories.values()].some(c => c.id !== update.id && normalizeIdentityText(c.name) === normalizeIdentityText(update.name))) {
      error("MASTER_CATEGORIES", plan.changes.find(c => c.id === update.id)!.row, "Category Name", "This edit would duplicate another category name.");
    }
  }
  if (seenProducts.size < snapshot.products.length || seenCategories.size < snapshot.categories.length) {
    plan.warnings.push("Omitted rows remain unchanged. Missing records are never deleted or archived.");
  }
  if (plan.categoryUpdates.some(c => !c.isActive)) plan.warnings.push("Archiving a category hides its active products from new vendor discovery under the existing catalog rules. Existing listings are not rewritten.");
  plan.warnings.push("Excel updates existing records only; IDs and discovery attributes are preserved. Category Name in MASTER_PRODUCTS is informational.");
  plan.valid = plan.errors.length === 0;
  if (!plan.valid) {
    plan.changes = [];
    plan.categoryUpdates = [];
    plan.productUpdates = [];
    plan.summary = { added: 0, updated: 0, archived: 0, unchanged: 0 };
  }
  return plan;
}
