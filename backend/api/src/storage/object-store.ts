/** Server-only byte storage. Authorization stays in the existing API routes. */
export interface ObjectMetadata {
  generation: string;
  mimeType: string;
  cacheControl: string;
  custom: Record<string, string | number | boolean | null>;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
}

export type ObjectWriteMetadata = Omit<ObjectMetadata, "generation">;

export interface ObjectStore {
  head(key: string): Promise<ObjectMetadata | null>;
  read(key: string): Promise<{ bytes: Buffer; metadata: ObjectMetadata }>;
  /** 0 means create-only; a generation means replace exactly that revision. */
  write(key: string, bytes: Buffer, metadata: ObjectWriteMetadata, generation: string | 0): Promise<void>;
  remove(key: string, generation: string): Promise<void>;
}

export class ObjectStoreError extends Error {
  constructor(public readonly code: "not-found" | "conflict" | "unavailable") {
    // Do not propagate SDK errors, object names, credentials, or signed URLs.
    super(`Object storage operation failed (${code}).`);
  }
}

export function safeObjectKey(value: string): string {
  if (!value || value.includes("\\") || value.split("/").some(
    part => !part || part === "." || part === ".." || !/^[\w.-]+$/.test(part),
  )) throw new Error("Invalid object storage path.");
  return value;
}

export function referenceRoot(value: string | undefined): string {
  if (!value) throw new Error("External GCS reference mapping is required.");
  return safeObjectKey(value.startsWith("/") ? value.slice(1) : value);
}
