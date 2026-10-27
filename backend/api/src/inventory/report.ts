import { NAMESPACES, type AssetClass, type Counts, type Failure, type Report } from "./contracts.js";

const reports = new WeakSet<object>();
export function finishReport(report: Report): Report {
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
/** Accept only the runner's internally constructed report, never SDK data. */
export function serializeReport(report: Report): string {
  if (!reports.has(report)) {
    return '{"complete":false,"status":"incomplete","failure":"INVALID_SOURCE_METADATA"}';
  }
  const counts = (value: Counts) => ({
    references: value.references, empty: value.empty, external: value.external,
    unsupported: value.unsupported, matched: value.matched,
    missingCandidates: value.missingCandidates, metadataMismatches: value.metadataMismatches,
  });
  return JSON.stringify({
    mode: report.mode, complete: report.complete, status: report.status,
    failure: report.failure, source: report.source, consistency: report.consistency,
    dbRows: report.dbRows, objects: report.objects, dbRequests: report.dbRequests,
    storageRequests: report.storageRequests, concurrentChanges: report.concurrentChanges,
    mappingCollisions: report.mappingCollisions,
    unreferencedCandidates: report.unreferencedCandidates,
    classes: {
      "product-images": counts(report.classes["product-images"]),
      "application-branding": counts(report.classes["application-branding"]),
      "vendor-documents": counts(report.classes["vendor-documents"]),
      "delivery-photos": counts(report.classes["delivery-photos"]),
      "store-logos": counts(report.classes["store-logos"]),
      "master-images": counts(report.classes["master-images"]),
    },
  });
}
