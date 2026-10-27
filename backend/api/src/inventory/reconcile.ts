import {
  InventoryFailure, PROJECTIONS, type AssetClass, type ListedObject, type Namespace,
  type Row, type Table,
} from "./contracts.js";
import { plainData } from "./policy.js";
import type { MutableReport } from "./report.js";

export interface Reference {
  asset: AssetClass;
  key: string;
  mime?: string;
  size?: number;
}
const segment = /^[\w-]{1,128}$/;
const optionalStrings = new Set(["image_url", "image", "logo_image_url", "master_product_id"]);
const timestamps = new Set(["updated_at", "uploaded_at", "captured_at"]);
export function checkRow(table: Table, input: Row): Row {
  try {
    const row = plainData(input);
    const keys = PROJECTIONS[table];
    if (Object.keys(row).length !== keys.length || Object.keys(row).some(k => !keys.includes(k as never))) {
      throw new Error();
    }
    for (const key of keys) {
      const value = row[key];
      if (optionalStrings.has(key) && value === null) continue;
      if (key === "is_active" || key === "is_current") {
        if (typeof value !== "boolean") throw new Error();
      } else if (key === "size_bytes" || key === "version") {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error();
      } else {
        if (typeof value !== "string" || value.length > 4096) throw new Error();
        if (timestamps.has(key) && !Number.isFinite(Date.parse(value))) throw new Error();
        if ((key === "id" || key.endsWith("_id")) && !segment.test(value)) throw new Error();
      }
    }
    return row as Row;
  } catch { throw new InventoryFailure("INVALID_SOURCE_METADATA"); }
}
export function canonicalKey(value: string): string {
  const key = value.replace(/^\/+/, "");
  if (!key || key.length > 4096 || key.split("/").some(
    part => !/^[\w.-]+$/.test(part) || part === "." || part === "..",
  )) throw new InventoryFailure("INVALID_SOURCE_METADATA");
  return key;
}
export function namespaceKey(key: string, namespace: Namespace, roots: { publicRoot: string; privateRoot: string }) {
  const root = namespace === "vendor-documents" || namespace === "delivery-photos"
    ? roots.privateRoot : roots.publicRoot;
  const prefix = `${root}/${namespace}/`;
  if (!key.startsWith(prefix)) throw new InventoryFailure("INVALID_SOURCE_METADATA");
  const suffix = key.slice(prefix.length).split("/");
  if (namespace === "application-branding" ? suffix.join("/") !== "active-logo"
    : suffix.length !== 2 || suffix.some(s => !segment.test(s))) {
    throw new InventoryFailure("INVALID_SOURCE_METADATA");
  }
}
export function checkObject(input: ListedObject, namespace: Namespace, roots: { publicRoot: string; privateRoot: string }) {
  try {
    const value = plainData(input);
    const required = ["key", "generation", "metageneration", "size", "contentType", "created", "updated"];
    const optional = ["crc32c", "md5Hash", "cacheControl", "contentDisposition",
      "contentEncoding", "contentLanguage", "visibility"];
    if (required.some(k => !(k in value)) || Object.keys(value).some(k => ![...required, ...optional].includes(k))) {
      throw new Error();
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "size") {
        if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) throw new Error();
      } else if (typeof item !== "string" || item.length > 4096) throw new Error();
    }
    if (!/^[1-9]\d*$/.test(input.generation) || !/^[1-9]\d*$/.test(input.metageneration) ||
        !Number.isFinite(Date.parse(input.created)) || !Number.isFinite(Date.parse(input.updated))) throw new Error();
    const key = canonicalKey(input.key);
    namespaceKey(key, namespace, roots);
    return key;
  } catch { throw new InventoryFailure("INVALID_SOURCE_METADATA"); }
}

function imageReference(asset: AssetClass, value: unknown, publicRoot: string,
  report: MutableReport, expectedStore?: string): Reference | undefined {
  const counts = report.classes[asset];
  if (value === null || value === "") { counts.empty++; return; }
  counts.references++;
  if (typeof value !== "string") { counts.unsupported++; return; }
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.username || url.password) throw new Error();
      counts.external++;
    } catch { counts.unsupported++; }
    return;
  }
  const match = /^\/api\/product-images\/([\w-]+)\/([\w-]+)$/.exec(value);
  if (!match || (expectedStore && expectedStore !== match[1]) ||
      !segment.test(match[1]!) || !segment.test(match[2]!)) {
    counts.unsupported++; return;
  }
  return { asset, key: `${publicRoot}/product-images/${match[1]}/${match[2]}` };
}
export function referencesForRows(rows: Record<Table, Row[]>,
  roots: { publicRoot: string; privateRoot: string }, report: MutableReport): Reference[] {
  const refs: Reference[] = [];
  const masters = new Map(rows.master_products.map(row => [row.id, row.image]));
  for (const row of rows.master_products) {
    const ref = imageReference("master-images", row.image, roots.publicRoot, report);
    if (ref) refs.push(ref);
  }
  for (const row of rows.stores) {
    const ref = imageReference("store-logos", row.logo_image_url, roots.publicRoot, report);
    if (ref) refs.push(ref);
  }
  for (const row of rows.products) {
    // Match SQL COALESCE exactly: only null uses the Master fallback.
    const value = row.image_url === null && row.master_product_id !== null
      ? masters.get(row.master_product_id) ?? null : row.image_url;
    const ref = imageReference("product-images", value, roots.publicRoot, report, String(row.store_id));
    if (ref) refs.push(ref);
  }
  for (const [table, asset] of [
    ["vendor_documents", "vendor-documents"], ["delivery_pickup_photos", "delivery-photos"],
  ] as const) for (const row of rows[table]) {
    report.classes[asset].references++;
    try {
      const key = canonicalKey(String(row.object_ref));
      namespaceKey(key, asset, roots);
      const owner = table === "vendor_documents" ? row.store_id : row.assignment_id;
      if (key !== `${roots.privateRoot}/${asset}/${owner}/${row.id}`) throw new Error();
      refs.push({ asset, key, mime: String(row.mime_type), size: Number(row.size_bytes) });
    } catch { report.classes[asset].unsupported++; }
  }
  report.classes["application-branding"].references++;
  refs.push({ asset: "application-branding", key: `${roots.publicRoot}/application-branding/active-logo` });
  return refs;
}

export function reconcile(refs: Reference[], objects: Map<string, ListedObject>, report: MutableReport) {
  const referenced = new Set<string>();
  const allowedMime: Record<AssetClass, readonly string[]> = {
    "product-images": ["image/jpeg", "image/png", "image/webp"],
    "application-branding": ["image/jpeg", "image/png"],
    "vendor-documents": ["application/pdf", "image/jpeg", "image/png"],
    "delivery-photos": ["image/jpeg", "image/png"],
    "store-logos": ["image/jpeg", "image/png", "image/webp"],
    "master-images": ["image/jpeg", "image/png", "image/webp"],
  };
  for (const ref of refs) {
    referenced.add(ref.key);
    const object = objects.get(ref.key);
    const counts = report.classes[ref.asset];
    if (!object) { counts.missingCandidates++; continue; }
    counts.matched++;
    if (!allowedMime[ref.asset].includes(object.contentType) ||
        (ref.mime !== undefined && ref.mime !== object.contentType) ||
        (ref.size !== undefined && ref.size !== object.size) ||
        (["vendor-documents", "delivery-photos"].includes(ref.asset) &&
          (object.cacheControl !== "private, no-store" || object.visibility !== "private"))) {
      counts.metadataMismatches++;
    }
  }
  report.unreferencedCandidates = [...objects.keys()].filter(key => !referenced.has(key)).length;
}
