import { InventoryFailure, NAMESPACES, PROJECTIONS, type ListedObject,
  type Namespace, type Page, type Policy, type Row, type Table } from "./contracts.js";
import { exactKeys, plainArray, plainData, validatePolicy } from "./policy.js";
import { checkObject, checkRow } from "./reconcile.js";

/** Pre-bound ports only: no URL, bucket selector, SQL, byte or write capability.
 * These are contracts, NOT installed live transports or an authorization boundary.
 */
export interface RestrictedReadPorts {
  databasePage(request: {
    table: Table; columns: readonly string[]; cursor?: string; limit: number; signal: AbortSignal;
  }): Promise<Page<Row>>;
  metadataPage(request: {
    namespace: Namespace; cursor?: string; limit: number; signal: AbortSignal;
  }): Promise<Page<ListedObject>>;
  /** Must cancel the underlying operation, roll back/release DB and close transports.
   * Resolving is an acknowledgement; a future real driver must prove this promise.
   */
  cancelAndClose(): Promise<void>;
}
type Failure = "BUDGET_EXCEEDED" | "TIMEOUT" | "INVALID_SOURCE_METADATA" |
  "READER_FAILED" | "CLOSED";
type Result<T> = { status: "PAGE"; page: Page<T> } |
  { status: "INCOMPLETE"; reason: Failure };

/** Offline preparation wrapper. Not connected to the CLI, grants or app startup. */
export function createRestrictedReaders(
  input: Policy, ports: RestrictedReadPorts,
  roots: Readonly<{ publicRoot: string; privateRoot: string }>,
) {
  const policy = validatePolicy(input), started = Date.now();
  const deadline = started + policy.limits.maxDurationMs;
  const dbDeadline = Math.min(deadline, started + policy.limits.maxDbDurationMs);
  // Snapshot logical roots; never accept a bucket name or reinterpret a reference.
  const rootInput = plainData(roots);
  exactKeys(rootInput, ["publicRoot", "privateRoot"]);
  if (typeof rootInput.publicRoot !== "string" || typeof rootInput.privateRoot !== "string") {
    throw new InventoryFailure("INVALID_POLICY");
  }
  const binding = Object.freeze({ publicRoot: rootInput.publicRoot, privateRoot: rootInput.privateRoot });
  if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(binding.publicRoot) ||
      !/^[\w.-]+(?:\/[\w.-]+)*$/.test(binding.privateRoot) ||
      binding.publicRoot.split("/").some(s => s === "." || s === "..") ||
      binding.privateRoot.split("/").some(s => s === "." || s === "..") ||
      binding.publicRoot === binding.privateRoot ||
      binding.publicRoot.startsWith(`${binding.privateRoot}/`) ||
      binding.privateRoot.startsWith(`${binding.publicRoot}/`)) throw new InventoryFailure("INVALID_POLICY");
  const traversal = new Map<string, { cursor?: string; done: boolean; seen: Set<string> }>();
  for (const name of [...Object.keys(PROJECTIONS), ...NAMESPACES]) {
    traversal.set(name, { done: false, seen: new Set() });
  }
  let rows = 0, objects = 0, dbRequests = 0, storageRequests = 0;
  let failure: Failure | null = null, busy = false, cancellationConfirmed = false;
  let active: AbortController | undefined, closing: Promise<void> | undefined;
  const stop = (reason: Failure) => {
    failure ??= reason;
    active?.abort();
    return closing ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Cleanup never extends the overall deadline; late acknowledgements do not
        // turn a failed session into a usable reader.
        const remaining = Math.max(0, Math.min(100, deadline - Date.now()));
        const acknowledged = Promise.resolve().then(() => ports.cancelAndClose());
        await Promise.race([acknowledged, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error()), remaining);
        })]);
        cancellationConfirmed = true;
      } catch { cancellationConfirmed = false; }
      finally { if (timer) clearTimeout(timer); }
    })();
  };
  async function read<T extends Row | ListedObject>(name: Table | Namespace, database: boolean): Promise<Result<T>> {
    if (failure) return { status: "INCOMPLETE", reason: failure };
    const state = traversal.get(name);
    if (busy || !state || state.done || (database ? !(name in PROJECTIONS) : !NAMESPACES.includes(name as Namespace))) {
      await stop("INVALID_SOURCE_METADATA");
      return { status: "INCOMPLETE", reason: failure! };
    }
    busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const end = Math.min(deadline, database ? dbDeadline : deadline,
        Date.now() + policy.limits.requestTimeoutMs);
      if (Date.now() >= end) throw new InventoryFailure("TIMEOUT");
      const used = database ? rows : objects;
      const cap = database ? policy.limits.maxDbRows : policy.limits.maxObjects;
      if (used >= cap || (database ? dbRequests >= policy.limits.maxDbRequests :
          storageRequests >= policy.limits.maxStorageRequests)) throw new InventoryFailure("BUDGET_EXCEEDED");
      const limit = Math.min(policy.limits.pageSize, cap - used);
      const controller = new AbortController();
      active = controller;
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new InventoryFailure("TIMEOUT"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      if (database) dbRequests++; else storageRequests++;
      const work = Promise.resolve().then<Page<Row | ListedObject>>(() => {
        if (controller.signal.aborted || failure) throw new InventoryFailure("TIMEOUT");
        return database ? ports.databasePage({ table: name as Table, columns: PROJECTIONS[name as Table],
          cursor: state.cursor, limit, signal: controller.signal })
        : ports.metadataPage({ namespace: name as Namespace,
          cursor: state.cursor, limit, signal: controller.signal });
      });
      const value = await Promise.race([work, cancelled, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new InventoryFailure("TIMEOUT")); controller.abort(); },
          Math.max(0, end - Date.now()));
      })]);
      if (failure) return { status: "INCOMPLETE", reason: failure };
      if (Date.now() >= end) throw new InventoryFailure("TIMEOUT");
      const page = plainData(value);
      exactKeys(page, page.nextCursor === undefined ? ["items", "changed"] : ["items", "changed", "nextCursor"]);
      const items = plainArray(page.items, limit);
      if (typeof page.changed !== "boolean" ||
          (page.nextCursor !== undefined && (typeof page.nextCursor !== "string" || !page.nextCursor ||
            page.nextCursor.length > 1024 || state.seen.has(page.nextCursor)))) {
        throw new InventoryFailure("INVALID_SOURCE_METADATA");
      }
      // Validate detached data before returning it; callers cannot mutate the ports' pages.
      for (const item of items) {
        if (database) checkRow(name as Table, item as Row);
        else checkObject(item as ListedObject, name as Namespace, binding);
      }
      const detached = structuredClone(value) as Page<T>;
      if (database) rows += detached.items.length; else objects += detached.items.length;
      state.cursor = detached.nextCursor;
      state.done = detached.nextCursor === undefined;
      if (state.cursor !== undefined) state.seen.add(state.cursor);
      if (Date.now() >= end) throw new InventoryFailure("TIMEOUT");
      return { status: "PAGE", page: detached };
    } catch (error) {
      const code: Failure = error instanceof InventoryFailure &&
        ["TIMEOUT", "BUDGET_EXCEEDED", "INVALID_SOURCE_METADATA"].includes(error.code)
        ? error.code as Failure : error instanceof InventoryFailure ? "INVALID_SOURCE_METADATA" : "READER_FAILED";
      await stop(code);
      return { status: "INCOMPLETE", reason: failure! };
    } finally {
      if (timer) clearTimeout(timer);
      if (active && onAbort) active.signal.removeEventListener("abort", onAbort);
      active = undefined; busy = false;
    }
  }
  return Object.freeze({
    database: Object.freeze({ page: (table: Table) => read<Row>(table, true) }),
    storage: Object.freeze({ list: (namespace: Namespace) => read<ListedObject>(namespace, false) }),
    close: () => stop("CLOSED"),
    summary: () => Object.freeze({
      status: !failure && [...traversal.values()].every(s => s.done) ? "TRAVERSAL_COMPLETE" : "INCOMPLETE",
      failure, rows, objects, dbRequests, storageRequests, cancellationConfirmed,
    }),
  });
}
