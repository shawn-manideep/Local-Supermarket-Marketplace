import {
  InventoryFailure, NAMESPACES, PROJECTIONS, type Failure, type ListedObject,
  type Page, type Policy, type Report, type Row, type Table,
} from "./contracts.js";
import { plainData, validatePolicy } from "./policy.js";
import { failedReport, finishReport, newReport, type MutableReport } from "./report.js";
import { checkObject, checkRow, reconcile, referencesForRows } from "./reconcile.js";
import { resolveSyntheticAuthorization } from "./synthetic.js";

export function validatePolicyOnly(input: unknown): Report {
  try {
    validatePolicy(input);
    return finishReport({ ...newReport("validate-policy-only"), complete: true, status: "validated-offline" });
  } catch { return failedReport("validate-policy-only", "INVALID_POLICY"); }
}

/** No clients or live factories exist here. Only fixture-bound grants are accepted. */
export async function runMetadataInventory(input: unknown, session?: object, authorization?: object): Promise<Report> {
  const report: MutableReport = newReport("metadata-only");
  let policy: Policy;
  try { policy = validatePolicy(input); }
  catch { return failedReport("metadata-only", "INVALID_POLICY"); }
  try {
    const binding = resolveSyntheticAuthorization(policy, session, authorization);
    report.source = "synthetic-in-memory";
    report.consistency = "non-atomic";
    const started = Date.now();
    const deadline = Math.min(started + policy.limits.maxDurationMs, binding.expires);
    const dbDeadline = Math.min(deadline, started + policy.limits.maxDbDurationMs);
    const rows: Record<Table, Row[]> = {
      products: [], master_products: [], stores: [], vendor_documents: [], delivery_pickup_photos: [],
    };
    const objects = new Map<string, ListedObject>();
    const rawKeys = new Map<string, string>();
    const seenRows = new Set<string>();
    async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, end: number): Promise<T> {
      const duration = Math.min(policy.limits.requestTimeoutMs, end - Date.now());
      if (duration <= 0) throw new InventoryFailure("TIMEOUT");
      const requestEnd = Date.now() + duration;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          operation(controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new InventoryFailure("TIMEOUT"));
              controller.abort();
            }, duration);
          }),
        ]);
        // Timer callbacks can be delayed by synchronous work in a reader.
        if (Date.now() >= end || Date.now() >= requestEnd) throw new InventoryFailure("TIMEOUT");
        return result;
      } finally { if (timer) clearTimeout(timer); controller.abort(); }
    }
    function checkPage<T>(page: Page<T>, limit: number, cursors: Set<string>) {
      let fields: Record<string, unknown>;
      try { fields = plainData(page); }
      catch { throw new InventoryFailure("INVALID_SOURCE_METADATA"); }
      if (Reflect.ownKeys(fields).some(key => !["items", "nextCursor", "changed"].includes(String(key))) ||
          !Array.isArray(page.items) || page.items.length > limit ||
          typeof page.changed !== "boolean" ||
          (page.nextCursor !== undefined && (typeof page.nextCursor !== "string" ||
            !page.nextCursor || page.nextCursor.length > 1024 || cursors.has(page.nextCursor)))) {
        throw new InventoryFailure("INVALID_SOURCE_METADATA");
      }
      if (page.nextCursor !== undefined) cursors.add(page.nextCursor);
      if (page.changed) report.concurrentChanges++;
    }
    for (const table of Object.keys(PROJECTIONS) as Table[]) {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        if (report.dbRequests >= policy.limits.maxDbRequests || report.dbRows >= policy.limits.maxDbRows) {
          throw new InventoryFailure("BUDGET_EXCEEDED");
        }
        const limit = Math.min(policy.limits.pageSize, policy.limits.maxDbRows - report.dbRows);
        report.dbRequests++;
        const page = await bounded(signal => binding.database.page(table, { cursor, limit, signal }), dbDeadline);
        checkPage(page, limit, cursors);
        for (const inputRow of page.items) {
          const row = checkRow(table, inputRow);
          const identity = `${table}:${row.id}`;
          if (seenRows.has(identity)) throw new InventoryFailure("INVALID_SOURCE_METADATA");
          seenRows.add(identity);
          rows[table].push(row);
          report.dbRows++;
          if (["updated_at", "uploaded_at"].some(k => typeof row[k] === "string" &&
              Date.parse(row[k] as string) >= started)) report.concurrentChanges++;
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
    }
    if (Date.now() >= dbDeadline) throw new InventoryFailure("TIMEOUT");
    const refs = referencesForRows(rows, binding, report);
    for (const namespace of NAMESPACES) {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        if (report.storageRequests >= policy.limits.maxStorageRequests || report.objects >= policy.limits.maxObjects) {
          throw new InventoryFailure("BUDGET_EXCEEDED");
        }
        const limit = Math.min(policy.limits.pageSize, policy.limits.maxObjects - report.objects);
        report.storageRequests++;
        const page = await bounded(signal => binding.storage.list(namespace, { cursor, limit, signal }), deadline);
        checkPage(page, limit, cursors);
        for (const object of page.items) {
          const key = checkObject(object, namespace, binding);
          report.objects++;
          const previous = objects.get(key);
          if (previous) {
            if (rawKeys.get(key) !== object.key) report.mappingCollisions++;
            else if (previous.generation !== object.generation ||
              previous.metageneration !== object.metageneration) report.concurrentChanges++;
            else throw new InventoryFailure("INVALID_SOURCE_METADATA");
          }
          objects.set(key, object);
          rawKeys.set(key, object.key);
          if (Date.parse(object.updated) >= started) report.concurrentChanges++;
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
    }
    reconcile(refs, objects, report);
    if (Date.now() >= deadline) throw new InventoryFailure("TIMEOUT");
    if (report.mappingCollisions || report.concurrentChanges ||
        Object.values(report.classes).some(c => c.unsupported || c.external ||
          c.missingCandidates || c.metadataMismatches)) {
      throw new InventoryFailure("RECONCILIATION_REQUIRED");
    }
    report.complete = true;
    report.status = "synthetic-complete";
    return finishReport(report);
  } catch (error) {
    const code: Failure = error instanceof InventoryFailure ? error.code : "READER_FAILED";
    // Only locally constructed codes cross the boundary; never stringify errors.
    report.failure = code;
    return finishReport(report);
  }
}
