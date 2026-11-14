import { createHash, randomUUID } from "node:crypto";
import { ObjectStoreError, safeObjectKey, type ObjectStore, type ObjectMetadata, type ObjectWriteMetadata } from "./object-store.js";
import { validateLiveAssetBytes } from "./live-asset-validation.js";

export type R2Failure = "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT" | "INTEGRITY"
  | "UNAVAILABLE" | "TIMEOUT" | "CANCELLED" | "UNKNOWN_OUTCOME";
export class R2Error extends ObjectStoreError {
  constructor(readonly category: R2Failure, readonly legacyEligible = false) {
    super(category === "NOT_FOUND" ? "not-found" : category === "CONFLICT" ? "conflict" : "unavailable");
    this.message = `R2 operation failed (${category}).`;
  }
}
export interface R2Request {
  kind: "get" | "put";
  key: string;
  maxBytes: number;
  signal: AbortSignal;
  body?: Buffer;
  metadata?: ObjectWriteMetadata;
  ifMatch?: string;
  ifNoneMatch?: "*";
}
export interface R2Response {
  body?: Buffer;
  etag?: string;
}
/** Fixed operations; no bucket selectors, listing, physical deletes or raw SDK errors. */
export type R2Transport = (request: R2Request) => Promise<R2Response>;
export interface R2Scope { publicRoot: string; privateRoot: string; prefix: string }
interface Manifest {
  version: 1;
  keyHash: string;
  revision: string;
  deleted: boolean;
  sha256: string;
  size: number;
  metadata: ObjectWriteMetadata;
}
const MAX_BYTES = 5 * 1024 * 1024;
const MANIFEST_LIMIT = 16 * 1024;
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A bounded strong HTTP entity-tag, not a content hash. Keep the original token
// (including quotes) for If-Match; weak tags and header/list injection are invalid.
function strongEtag(value: unknown): value is string {
  return typeof value === "string" && value.length >= 2 && value.length <= 1024
    && value.startsWith('"') && value.endsWith('"')
    && !/[^\x21\x23-\x7e\x80-\xff]/.test(value.slice(1, -1));
}

export function r2ObjectStore(
  transport: R2Transport,
  scope: R2Scope,
  options: { timeoutMs?: number; signal?: AbortSignal; category?: "delivery-photos" } = {},
): ObjectStore {
  const { publicRoot, privateRoot, prefix } = scope;
  const category = options.category;
  if (category !== undefined && category !== "delivery-photos") throw new R2Error("INVALID_INPUT");
  for (const root of [publicRoot, privateRoot, prefix]) safeObjectKey(root);
  if (publicRoot === privateRoot || publicRoot.startsWith(`${privateRoot}/`)
    || privateRoot.startsWith(`${publicRoot}/`)) throw new R2Error("INVALID_INPUT");
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw new R2Error("INVALID_INPUT");
  function locate(key: string) {
    try { safeObjectKey(key); } catch { throw new R2Error("INVALID_INPUT"); }
    const parts = (root: string) => key.startsWith(`${root}/`) ? key.slice(root.length + 1).split("/") : [];
    const pub = parts(publicRoot), priv = parts(privateRoot);
    const isPrivate = priv.length === 3 && ["vendor-documents", "delivery-photos"].includes(priv[0]!);
    const kind = isPrivate ? priv[0] : pub.length === 3 && pub[0] === "product-images" ? "product-images"
      : pub.length === 2 && pub[0] === "application-branding" && pub[1] === "active-logo" ? "branding" : undefined;
    if (!kind || category !== undefined && kind !== category) throw new R2Error("INVALID_INPUT");
    const keyHash = hash(key);
    return { keyHash, kind, isPrivate, manifestKey: `${prefix}/references/${keyHash}` };
  }
  function metadata(value: ObjectWriteMetadata, kind: string, isPrivate: boolean) {
    if (!value || typeof value !== "object" || !value.custom || Array.isArray(value.custom)
      || !["image/png", "image/jpeg", ...(kind === "vendor-documents" ? ["application/pdf"] : []),
        ...(kind === "product-images" ? ["image/webp"] : [])].includes(value.mimeType)
      || value.cacheControl !== (isPrivate ? "private, no-store" : "no-store")
      || isPrivate && value.custom.visibility !== "private"
      || Object.keys(value.custom).length > 20) throw new R2Error("INVALID_INPUT");
    for (const field of [value.contentDisposition, value.contentEncoding, value.contentLanguage]) {
      if (field !== undefined && (typeof field !== "string" || field.length > 256 || /[\r\n\0]/.test(field))) {
        throw new R2Error("INVALID_INPUT");
      }
    }
    for (const [key, v] of Object.entries(value.custom)) {
      if (!/^[a-zA-Z][\w-]{0,40}$/.test(key) || !(v === null || typeof v === "boolean"
        || typeof v === "number" && Number.isFinite(v) || typeof v === "string" && v.length <= 512)) {
        throw new R2Error("INVALID_INPUT");
      }
    }
  }
  async function operation<T>(work: (send: R2Transport) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let mutationStarted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      if (options.signal?.aborted) throw new R2Error("CANCELLED");
      const stopped = new Promise<never>((_, reject) => {
        abort = () => {
          controller.abort();
          reject(new R2Error(mutationStarted ? "UNKNOWN_OUTCOME" : "CANCELLED"));
        };
        options.signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => {
          controller.abort();
          reject(new R2Error(mutationStarted ? "UNKNOWN_OUTCOME" : "TIMEOUT"));
        }, timeoutMs);
      });
      const send: R2Transport = async request => {
        if (controller.signal.aborted) throw new R2Error(mutationStarted ? "UNKNOWN_OUTCOME" : "CANCELLED");
        if (request.kind === "put") mutationStarted = true;
        try { return await transport({ ...request, signal: controller.signal }); }
        catch (error) {
          if (error instanceof R2Error) throw error;
          throw new R2Error(mutationStarted ? "UNKNOWN_OUTCOME" : "UNAVAILABLE");
        }
      };
      return await Promise.race([work(send), stopped]);
    } catch (error) {
      if (error instanceof R2Error) throw error;
      throw new R2Error(mutationStarted ? "UNKNOWN_OUTCOME" : "UNAVAILABLE");
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) options.signal?.removeEventListener("abort", abort);
    }
  }
  const signal = new AbortController().signal; // overwritten by the operation budget
  type Location = ReturnType<typeof locate>;
  async function current(send: R2Transport, location: Location) {
    let result: R2Response;
    try {
      result = await send({ kind: "get", key: location.manifestKey, maxBytes: MANIFEST_LIMIT, signal });
    } catch (error) {
      if (error instanceof R2Error && error.category === "NOT_FOUND") return null;
      throw error;
    }
    try {
      if (!result.body || result.body.length > MANIFEST_LIMIT || !strongEtag(result.etag)) throw new Error();
      const value = JSON.parse(result.body.toString("utf8")) as Manifest;
      if (value.version !== 1 || value.keyHash !== location.keyHash || !uuid.test(value.revision)
        || typeof value.deleted !== "boolean" || !/^[a-f0-9]{64}$/.test(value.sha256)
        || !Number.isInteger(value.size) || value.size < 1 || value.size > MAX_BYTES) throw new Error();
      metadata(value.metadata, location.kind, location.isPrivate);
      return { value, etag: result.etag };
    } catch { throw new R2Error("INTEGRITY"); }
  }
  async function verifiedPayload(send: R2Transport, location: Location, value: Manifest) {
    let result: R2Response;
    try {
      result = await send({ kind: "get", key: `${prefix}/objects/${location.keyHash}/${value.revision}`,
        maxBytes: value.size, signal });
    } catch (error) {
      if (error instanceof R2Error && error.category === "NOT_FOUND") throw new R2Error("INTEGRITY");
      throw error;
    }
    if (!result.body || result.body.length !== value.size || hash(result.body) !== value.sha256) {
      throw new R2Error("INTEGRITY");
    }
    try { validateLiveAssetBytes(result.body, value.metadata.mimeType); }
    catch { throw new R2Error("INTEGRITY"); }
    return result.body;
  }
  async function publish(send: R2Transport, location: Location, value: Manifest, etag?: string) {
    const body = Buffer.from(JSON.stringify(value));
    if (body.length > MANIFEST_LIMIT) throw new R2Error("INVALID_INPUT");
    await send({ kind: "put", key: location.manifestKey, maxBytes: MANIFEST_LIMIT, signal, body,
      metadata: { mimeType: "application/json", cacheControl: "private, no-store", custom: {} },
      ...(etag ? { ifMatch: etag } : { ifNoneMatch: "*" as const }) });
  }
  return {
    async head(key) {
      const location = locate(key);
      return operation(async send => {
        const entry = await current(send, location);
        return !entry || entry.value.deleted ? null : { ...entry.value.metadata, generation: entry.value.revision };
      });
    },
    async read(key) {
      const location = locate(key);
      return operation(async send => {
        const entry = await current(send, location);
        if (!entry || entry.value.deleted) throw new R2Error("NOT_FOUND", !entry);
        const m = entry.value;
        const bytes = await verifiedPayload(send, location, m);
        return { bytes, metadata: { ...m.metadata, generation: m.revision } };
      });
    },
    async write(key, bytes, attributes, expected) {
      const location = locate(key);
      metadata(attributes, location.kind, location.isPrivate);
      try { validateLiveAssetBytes(bytes, attributes.mimeType); }
      catch { throw new R2Error("INVALID_INPUT"); }
      if (expected !== 0 && !uuid.test(expected)) throw new R2Error("INVALID_INPUT");
      // Snapshot caller-owned data before any await.
      const payload = Buffer.from(bytes);
      const attributesCopy = structuredClone(attributes);
      return operation(async send => {
        const entry = await current(send, location);
        // Tombstones are permanent ownership records: logical keys are never reused.
        if (expected === 0 ? entry !== null : !entry || entry.value.deleted || entry.value.revision !== expected) {
          throw new R2Error("CONFLICT");
        }
        const revision = randomUUID();
        const value: Manifest = { version: 1, keyHash: location.keyHash, revision, deleted: false,
          sha256: hash(payload), size: payload.length, metadata: attributesCopy };
        await send({ kind: "put", key: `${prefix}/objects/${location.keyHash}/${revision}`,
          maxBytes: MAX_BYTES, signal, body: payload, metadata: attributesCopy, ifNoneMatch: "*" });
        // A lost response may mean commit succeeded. NEVER retry or delete this payload.
        // Verify persisted bytes before making this revision discoverable. Failure
        // leaves the payload retained and the old manifest (if any) untouched.
        await verifiedPayload(send, location, value);
        await publish(send, location, value, entry?.etag);
      });
    },
    async remove(key, expected) {
      const location = locate(key);
      if (!uuid.test(expected)) throw new R2Error("INVALID_INPUT");
      return operation(async send => {
        const entry = await current(send, location);
        if (!entry || entry.value.deleted || entry.value.revision !== expected) throw new R2Error("CONFLICT");
        await publish(send, location, { ...entry.value, deleted: true, revision: randomUUID() }, entry.etag);
        // Logical deletion only. No DeleteObject, no payload reclamation and no ABA.
      });
    },
  };
}
