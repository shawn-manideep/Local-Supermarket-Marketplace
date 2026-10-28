import { types } from "node:util";
import {
  InventoryFailure, LIMIT_CAPS, NAMESPACES,
  type AssetClass, type Counts, type Failure, type Report,
} from "./contracts.js";

const assetClasses = [...NAMESPACES, "store-logos", "master-images"] as const;
const countKeys = ["references", "empty", "external", "unsupported", "matched",
  "missingCandidates", "metadataMismatches"] as const;
// Each row contributes at most one reference per class, plus implicit branding.
const classCountCap = LIMIT_CAPS.maxDbRows + 1;
const aggregateCaps = {
  dbRows: LIMIT_CAPS.maxDbRows, objects: LIMIT_CAPS.maxObjects,
  dbRequests: LIMIT_CAPS.maxDbRequests, storageRequests: LIMIT_CAPS.maxStorageRequests,
  // A listed object can flag both a generation change and an updated timestamp.
  concurrentChanges: LIMIT_CAPS.maxDbRows + 2 * LIMIT_CAPS.maxObjects
    + LIMIT_CAPS.maxDbRequests + LIMIT_CAPS.maxStorageRequests,
  mappingCollisions: LIMIT_CAPS.maxObjects, unreferencedCandidates: LIMIT_CAPS.maxObjects,
};
const invalid = (): never => { throw new InventoryFailure("INVALID_SOURCE_METADATA"); };

/** Copy only exact own data properties; never invoke accessors or toJSON hooks. */
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || types.isProxy(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== keys.length || ownKeys.some(key =>
    typeof key !== "string" || !keys.includes(key))) return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const property = descriptors[key];
    if (!property || !("value" in property) || !property.enumerable) return invalid();
    result[key] = property.value;
  }
  return result;
}
function count(input: unknown, cap: number): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input)
    || input < 0 || Object.is(input, -0) || input > cap) return invalid();
  return input;
}
/** Runtime schema shared by registration and independent serialization checks. */
function checkedReport(input: unknown): Report {
  const value = record(input, ["mode", "complete", "status", "failure", "source",
    "consistency", ...Object.keys(aggregateCaps), "classes"]);
  if (!["validate-policy-only", "metadata-only"].includes(value.mode as string)
    || typeof value.complete !== "boolean"
    || !["validated-offline", "synthetic-complete", "incomplete"].includes(value.status as string)
    || !["none", "synthetic-in-memory"].includes(value.source as string)
    || !["not-checked", "non-atomic"].includes(value.consistency as string)
    || (value.failure !== null && !["INVALID_POLICY", "EXECUTION_NOT_AUTHORIZED",
      "LIVE_EXECUTION_UNAVAILABLE", "BUDGET_EXCEEDED", "TIMEOUT", "PERMISSION_DENIED",
      "INVALID_SOURCE_METADATA", "READER_FAILED", "RECONCILIATION_REQUIRED"].includes(value.failure as string))) return invalid();
  if (value.complete !== (value.status !== "incomplete")
    || (value.complete && value.failure !== null)
    || (value.status === "validated-offline" && (value.mode !== "validate-policy-only"
      || value.source !== "none" || value.consistency !== "not-checked"))
    || (value.status === "synthetic-complete" && (value.mode !== "metadata-only"
      || value.source !== "synthetic-in-memory" || value.consistency !== "non-atomic"))) return invalid();
  const aggregates = {} as Record<keyof typeof aggregateCaps, number>;
  for (const key of Object.keys(aggregateCaps) as (keyof typeof aggregateCaps)[]) {
    aggregates[key] = count(value[key], aggregateCaps[key]);
  }
  const rawClasses = record(value.classes, assetClasses);
  const classes = {} as Record<AssetClass, Counts>;
  for (const asset of assetClasses) {
    const rawCounts = record(rawClasses[asset], countKeys);
    const counts = {} as Counts;
    for (const key of countKeys) counts[key] = count(rawCounts[key], classCountCap);
    classes[asset] = counts;
  }
  if (value.status === "synthetic-complete" && (aggregates.mappingCollisions > 0 ||
      aggregates.concurrentChanges > 0 || Object.values(classes).some(c =>
        c.unsupported > 0 || c.external > 0 || c.missingCandidates > 0 || c.metadataMismatches > 0))) return invalid();
  // Every field above is checked before the typed, detached snapshot is created.
  return { mode: value.mode, complete: value.complete, status: value.status,
    failure: value.failure, source: value.source, consistency: value.consistency,
    ...aggregates, classes } as Report;
}

const reports = new WeakSet<object>();
export function finishReport(input: unknown): Report {
  const report = checkedReport(input);
  for (const counts of Object.values(report.classes)) Object.freeze(counts);
  Object.freeze(report.classes);
  Object.freeze(report);
  reports.add(report);
  return report;
}
export function emptyCounts(): Counts {
  return { references: 0, empty: 0, external: 0, unsupported: 0,
    matched: 0, missingCandidates: 0, metadataMismatches: 0 };
}
export function newReport(mode: Report["mode"]): Report {
  const classes = {} as Record<AssetClass, Counts>;
  for (const name of [...NAMESPACES, "store-logos", "master-images"] as const) {
    classes[name] = emptyCounts();
  }
  return {
    mode, complete: false, status: "incomplete", failure: null, source: "none",
    consistency: "not-checked", dbRows: 0, objects: 0, dbRequests: 0,
    storageRequests: 0, concurrentChanges: 0, mappingCollisions: 0,
    unreferencedCandidates: 0, classes,
  };
}
export type MutableReport = { -readonly [K in keyof Report]: Report[K] };
export function failedReport(mode: Report["mode"], failure: Failure): Report {
  return finishReport({ ...newReport(mode), failure });
}
/** Require registration, then independently revalidate a detached output snapshot. */
export function serializeReport(report: Report): string {
  if (!reports.has(report)) {
    return '{"complete":false,"status":"incomplete","failure":"INVALID_SOURCE_METADATA"}';
  }
  let checked: Report;
  try { checked = checkedReport(report); }
  catch { return '{"complete":false,"status":"incomplete","failure":"INVALID_SOURCE_METADATA"}'; }
  const counts = (value: Counts) => ({
    references: value.references, empty: value.empty, external: value.external,
    unsupported: value.unsupported, matched: value.matched,
    missingCandidates: value.missingCandidates, metadataMismatches: value.metadataMismatches,
  });
  return JSON.stringify({
    mode: checked.mode, complete: checked.complete, status: checked.status,
    failure: checked.failure, source: checked.source, consistency: checked.consistency,
    dbRows: checked.dbRows, objects: checked.objects, dbRequests: checked.dbRequests,
    storageRequests: checked.storageRequests, concurrentChanges: checked.concurrentChanges,
    mappingCollisions: checked.mappingCollisions,
    unreferencedCandidates: checked.unreferencedCandidates,
    classes: {
      "product-images": counts(checked.classes["product-images"]),
      "application-branding": counts(checked.classes["application-branding"]),
      "vendor-documents": counts(checked.classes["vendor-documents"]),
      "delivery-photos": counts(checked.classes["delivery-photos"]),
      "store-logos": counts(checked.classes["store-logos"]),
      "master-images": counts(checked.classes["master-images"]),
    },
  });
}
