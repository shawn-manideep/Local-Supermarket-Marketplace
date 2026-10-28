import {
  InventoryFailure, type DatabaseMetadataReader, type StorageMetadataLister,
  type ListedObject, type Namespace, type PageRequest, type Policy, type Row, type Table,
} from "./contracts.js";
import { policyDigest, validatePolicy } from "./policy.js";

export interface SyntheticDataset {
  tables: Record<Table, Row[]>;
  objects: Record<Namespace, ListedObject[]>;
  fault?: "permission" | "sdk-error" | "stall" | "repeated-cursor" |
    "extra-page-field" | "oversized-page" | "synchronous-delay";
  faultAt?: "database" | "storage";
  changed?: boolean;
}
interface Binding {
  digest: string;
  expires: number;
  session: object;
  database: DatabaseMetadataReader;
  storage: StorageMetadataLister;
  publicRoot: string;
  privateRoot: string;
}
const grants = new WeakMap<object, Binding>();
export function resolveSyntheticAuthorization(policy: Policy, session?: object, authorization?: object): Binding {
  const binding = authorization && grants.get(authorization);
  if (!binding || binding.session !== session || binding.expires <= Date.now() ||
      binding.digest !== policyDigest(policy)) throw new InventoryFailure("EXECUTION_NOT_AUTHORIZED");
  grants.delete(authorization!); // Single-use; flags and copied objects cannot replay a grant.
  return binding;
}
/**
 * Only in-memory sessions can be minted. No injected callback, client, file, URL,
 * environment, credential provider or SDK is accepted. NOT a live authorizer.
 */
export function createSyntheticSession(policyInput: unknown, input: SyntheticDataset, ttlMs = 180_000) {
  const policy = validatePolicy(policyInput);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 180_000) {
    throw new InventoryFailure("EXECUTION_NOT_AUTHORIZED");
  }
  let data: SyntheticDataset;
  try { data = structuredClone(input); }
  catch { throw new InventoryFailure("INVALID_SOURCE_METADATA"); }
  const operations = { databasePages: 0, storagePages: 0 };
  async function page<T>(items: readonly T[], request: PageRequest, phase: "database" | "storage") {
    const fault = !data.faultAt || data.faultAt === phase ? data.fault : undefined;
    if (fault === "permission") throw new InventoryFailure("PERMISSION_DENIED");
    if (fault === "sdk-error") throw new Error(JSON.stringify(data));
    if (fault === "stall") {
      await new Promise<void>((_, reject) => request.signal.addEventListener(
        "abort", () => reject(new Error("synthetic aborted")), { once: true },
      ));
    }
    const start = Number(request.cursor ?? "0");
    const next = start + request.limit;
    if (fault === "synchronous-delay") {
      const end = Date.now() + 15;
      while (Date.now() < end) { /* Fixture: delay the timer callback deliberately. */ }
    }
    return {
      items: fault === "oversized-page" ? Array(request.limit + 1).fill(items[0]) : items.slice(start, next),
      changed: data.changed ?? false,
      ...(fault === "extra-page-field" ? { unexpected: "SYNTHETIC-PRIVATE" } : {}),
      ...(fault === "repeated-cursor" ? { nextCursor: "0" }
        : next < items.length ? { nextCursor: String(next) } : {}),
    };
  }
  const database = Object.freeze({
    async page(table: Table, request: PageRequest) {
      operations.databasePages++;
      return page(data.tables[table], request, "database");
    },
  });
  const storage = Object.freeze({
    async list(namespace: Namespace, request: PageRequest) {
      operations.storagePages++;
      return page(data.objects[namespace], request, "storage");
    },
  });
  const session = Object.freeze({});
  const authorization = Object.freeze({});
  grants.set(authorization, Object.freeze({
    digest: policyDigest(policy), expires: Date.now() + ttlMs, session,
    database, storage, publicRoot: "fixture-public", privateRoot: "fixture-private",
  }));
  return Object.freeze({
    session, authorization,
    stats: () => Object.freeze({ ...operations }),
  });
}

export function emptySyntheticDataset(): SyntheticDataset {
  return {
    tables: { products: [], master_products: [], stores: [], vendor_documents: [], delivery_pickup_photos: [] },
    objects: { "product-images": [], "application-branding": [], "vendor-documents": [], "delivery-photos": [] },
  };
}
