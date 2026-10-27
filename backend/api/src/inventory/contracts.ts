/** Deliberately no database client, SQL text, bucket selector, or SDK handle. */
export const PROJECTIONS = Object.freeze({
  products: ["id", "store_id", "master_product_id", "image_url", "is_active", "updated_at"],
  master_products: ["id", "image", "is_active", "updated_at"],
  stores: ["id", "logo_image_url", "updated_at"],
  vendor_documents: ["id", "store_id", "document_type", "object_ref", "mime_type",
    "size_bytes", "version", "is_current", "uploaded_at", "updated_at"],
  delivery_pickup_photos: ["id", "assignment_id", "object_ref", "mime_type",
    "size_bytes", "captured_at", "uploaded_at"],
} as const);
for (const columns of Object.values(PROJECTIONS)) Object.freeze(columns);

export type Table = keyof typeof PROJECTIONS;
export const NAMESPACES = Object.freeze([
  "product-images", "application-branding", "vendor-documents", "delivery-photos",
] as const);
export type Namespace = typeof NAMESPACES[number];
export type AssetClass = Namespace | "store-logos" | "master-images";
export type Row = Readonly<Record<string, string | number | boolean | null>>;
export interface PageRequest {
  readonly cursor?: string;
  readonly limit: number;
  readonly signal: AbortSignal;
}
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly changed: boolean;
}
export interface DatabaseMetadataReader {
  page(table: Table, request: PageRequest): Promise<Page<Row>>;
}
/** Logical key already mapped by the source binding; never a destination selector. */
export interface ListedObject {
  readonly key: string;
  readonly generation: string;
  readonly metageneration: string;
  readonly size: number;
  readonly contentType: string;
  readonly created: string;
  readonly updated: string;
  readonly crc32c?: string;
  readonly md5Hash?: string;
  readonly cacheControl?: string;
  readonly contentDisposition?: string;
  readonly contentEncoding?: string;
  readonly contentLanguage?: string;
  readonly visibility?: string;
}
export interface StorageMetadataLister {
  list(namespace: Namespace, request: PageRequest): Promise<Page<ListedObject>>;
}
export const LIMIT_CAPS = Object.freeze({
  pageSize: 200, maxDbRows: 10_000, maxObjects: 10_000,
  maxDbRequests: 60, maxStorageRequests: 55,
  requestTimeoutMs: 5_000, maxDurationMs: 180_000, maxDbDurationMs: 60_000,
});
export interface Policy {
  readonly version: 1;
  /** Logical allowlist label only, NOT proof of live service identity. */
  readonly target: "original-apna-local-basket";
  readonly history: "current-objects-and-retained-document-rows";
  readonly namespaces: readonly Namespace[];
  readonly limits: Readonly<{ [K in keyof typeof LIMIT_CAPS]: number }>;
}
export type Failure = "INVALID_POLICY" | "EXECUTION_NOT_AUTHORIZED" |
  "LIVE_EXECUTION_UNAVAILABLE" | "BUDGET_EXCEEDED" | "TIMEOUT" |
  "PERMISSION_DENIED" | "INVALID_SOURCE_METADATA" | "READER_FAILED";
export interface Counts {
  references: number;
  empty: number;
  external: number;
  unsupported: number;
  matched: number;
  missingCandidates: number;
  metadataMismatches: number;
}
export interface Report {
  readonly mode: "validate-policy-only" | "metadata-only";
  readonly complete: boolean;
  readonly status: "validated-offline" | "synthetic-complete" | "incomplete";
  readonly failure: Failure | null;
  readonly source: "none" | "synthetic-in-memory";
  readonly consistency: "not-checked" | "non-atomic";
  readonly dbRows: number;
  readonly objects: number;
  readonly dbRequests: number;
  readonly storageRequests: number;
  readonly concurrentChanges: number;
  readonly mappingCollisions: number;
  readonly unreferencedCandidates: number;
  readonly classes: Readonly<Record<AssetClass, Counts>>;
}

export class InventoryFailure extends Error {
  constructor(readonly code: Failure) { super(code); }
}
