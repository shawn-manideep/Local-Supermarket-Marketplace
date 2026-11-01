import { plainData } from "../inventory/policy.js";
import { safeObjectKey, type ObjectWriteMetadata } from "./object-store.js";
import { SUPABASE_STORAGE_PROJECT, snapshotSupabaseStorageConfig, type SupabaseStorageConfig } from "./supabase-storage-config.js";

export type SupabaseFailure = "INVALID_INPUT" | "INVALID_BINDING" | "NOT_FOUND" | "CONFLICT" |
  "UNAVAILABLE" | "CANCELLED" | "TIMEOUT" | "UNKNOWN_OUTCOME" | "CLOSED" |
  "BUSY" | "BUDGET_EXCEEDED" | "CAPABILITY_UNAVAILABLE" | "LIVE_OPERATIONS_DISABLED";
export class SupabaseStorageError extends Error {
  constructor(readonly code: SupabaseFailure) {
    super(`Supabase storage operation failed (${code}).`);
  }
}
export interface BasicMetadata {
  mimeType: string;
  size: number;
  /** Opaque provider revision; absence is not equivalent to a GCS generation. */
  revision?: string;
  cacheControl?: string;
  custom?: ObjectWriteMetadata["custom"];
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
}
export interface SupabaseFixtureBinding {
  readonly projectRef: string;
  readonly bucket: string;
  readonly privateBucket: boolean;
}
/** Injected preparation port, NOT an SDK implementation or proof of private IAM. */
export interface SupabaseBasicPort extends SupabaseFixtureBinding {
  info(key: string, signal: AbortSignal): Promise<BasicMetadata | null>;
  upload(key: string, bytes: Buffer, options: {
    upsert: false; contentType: string; cacheControl: "0"; metadata: Record<string, unknown>;
  }, signal: AbortSignal): Promise<void>;
  download(key: string, signal: AbortSignal): Promise<{ bytes: Buffer; mimeType: string }>;
  cancelAndClose(): Promise<void>;
}
export interface OperationOptions {
  requestTimeoutMs?: number;
  maxDurationMs?: number;
  maxRequests?: number;
}
const denied = (code: SupabaseFailure): never => { throw new SupabaseStorageError(code); };

export function assertSupabaseBinding(config: SupabaseStorageConfig, port: SupabaseFixtureBinding) {
  if (config.projectRef !== SUPABASE_STORAGE_PROJECT || port.projectRef !== config.projectRef ||
      port.bucket !== config.bucket || port.privateBucket !== true) denied("INVALID_BINDING");
}
export function supabaseAssetKey(config: SupabaseStorageConfig, key: string): string {
  try {
    safeObjectKey(key);
    const under = (root: string, area: string) => key.startsWith(`${root}/${area}/`);
    const area = under(config.publicRoot, "product-images") ? "product-images"
      : under(config.privateRoot, "vendor-documents") ? "vendor-documents"
      : under(config.privateRoot, "delivery-photos") ? "delivery-photos" : null;
    if (key === `${config.publicRoot}/application-branding/active-logo`) return key;
    if (!area) return denied("INVALID_INPUT");
    const root = area === "product-images" ? config.publicRoot : config.privateRoot;
    if (key.slice(`${root}/${area}/`.length).split("/").length !== 2) denied("INVALID_INPUT");
    return key;
  } catch { return denied("INVALID_INPUT"); }
}
export function validRevision(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) denied("INVALID_INPUT");
  return value as string;
}
export function validateBytes(bytes: unknown, mime: unknown): asserts bytes is Buffer {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 5 * 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(String(mime))) denied("INVALID_INPUT");
}
export function validateBasicMetadata(input: unknown): BasicMetadata {
  try {
    const value = plainData(input);
    if (Object.keys(value).some(k => !["mimeType", "size", "revision", "cacheControl", "custom",
      "contentDisposition", "contentEncoding", "contentLanguage"].includes(k)) ||
        !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(String(value.mimeType)) ||
        !Number.isSafeInteger(value.size) || Number(value.size) < 1 || Number(value.size) > 5 * 1024 * 1024) denied("UNAVAILABLE");
    const metadata = validateWriteMetadata({
      mimeType: value.mimeType, cacheControl: value.cacheControl ?? "no-store", custom: value.custom ?? {},
      ...Object.fromEntries(["contentDisposition", "contentEncoding", "contentLanguage"]
        .filter(k => value[k] !== undefined).map(k => [k, value[k]])),
    });
    return { ...metadata, size: value.size as number,
      ...(value.revision === undefined ? {} : { revision: validRevision(value.revision) }) };
  } catch { return denied("UNAVAILABLE"); }
}

export function validateWriteMetadata(input: unknown): ObjectWriteMetadata {
  try {
    const value = plainData(input);
    if (Object.keys(value).some(k => !["mimeType", "cacheControl", "custom", "contentDisposition",
      "contentEncoding", "contentLanguage"].includes(k)) ||
      !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(String(value.mimeType)) ||
      typeof value.cacheControl !== "string" || value.cacheControl.length > 256) denied("INVALID_INPUT");
    const custom = plainData(value.custom);
    if (Object.keys(custom).length > 64 || Object.entries(custom).some(([key, entry]) =>
      !/^[\w.-]{1,64}$/.test(key) || !(entry === null || typeof entry === "boolean" ||
        (typeof entry === "number" && Number.isFinite(entry)) ||
        (typeof entry === "string" && entry.length <= 1024)))) denied("INVALID_INPUT");
    const optional: Record<string, string> = {};
    for (const key of ["contentDisposition", "contentEncoding", "contentLanguage"]) {
      if (value[key] !== undefined) {
        if (typeof value[key] !== "string" || value[key].length > 1024 || /[\r\n]/.test(value[key])) denied("INVALID_INPUT");
        optional[key] = value[key] as string;
      }
    }
    return { mimeType: value.mimeType as string, cacheControl: value.cacheControl as string,
      custom: { ...custom } as ObjectWriteMetadata["custom"], ...optional };
  } catch { return denied("INVALID_INPUT"); }
}

/** Bounded, single-flight fixture execution; never creates or discovers a transport. */
export function createSupabaseBoundary(closePort: () => Promise<void>, options: OperationOptions = {}) {
  const requestMs = options.requestTimeoutMs ?? 1000, duration = options.maxDurationMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 64;
  if (![requestMs, duration, maxRequests].every(Number.isSafeInteger) ||
      requestMs < 1 || requestMs > 5000 || duration < requestMs || duration > 180_000 ||
      maxRequests < 1 || maxRequests > 1000) denied("INVALID_INPUT");
  const deadline = Date.now() + duration;
  let closed = false, busy = false, requests = 0, active: AbortController | undefined;
  let closing: Promise<void> | undefined, cancellationConfirmed = false;
  const close = () => {
    closed = true;
    active?.abort();
    return closing ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.resolve().then(closePort), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error()), 100);
        })]);
        cancellationConfirmed = true;
      } catch { cancellationConfirmed = false; }
      finally { if (timer) clearTimeout(timer); }
    })();
  };
  return {
    close,
    state: () => ({ closed, requests, cancellationConfirmed }),
    async run<T>(mutation: boolean, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (closed) denied("CLOSED");
      if (busy) denied("BUSY");
      if (signal?.aborted) denied("CANCELLED");
      if (requests >= maxRequests) denied("BUDGET_EXCEEDED");
      if (Date.now() >= deadline) { await close(); return denied("TIMEOUT"); }
      busy = true;
      requests++;
      const controller = new AbortController();
      active = controller;
      let timer: ReturnType<typeof setTimeout> | undefined, started = false;
      let reason: "TIMEOUT" | "CANCELLED" = "CANCELLED";
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      let onAbort: (() => void) | undefined;
      try {
        const interrupted = new Promise<never>((_, reject) => {
          onAbort = () => reject(new SupabaseStorageError(reason));
          controller.signal.addEventListener("abort", onAbort, { once: true });
        });
        timer = setTimeout(() => { reason = "TIMEOUT"; controller.abort(); },
          Math.min(requestMs, Math.max(0, deadline - Date.now())));
        const work = Promise.resolve().then(() => {
          if (controller.signal.aborted) denied(reason);
          started = true;
          return operation(controller.signal);
        });
        return await Promise.race([work, interrupted]);
      } catch (error) {
        // Only our own errors and an exact status value are interpreted. Never
        // forward SDK messages, response bodies, URLs, credentials or causes.
        const status = (() => {
          try { return plainData(error).statusCode; } catch { return undefined; }
        })();
        if (error instanceof SupabaseStorageError && !["TIMEOUT", "CANCELLED"].includes(error.code)) {
          // Even fixture ports must not smuggle a modified message/stack/cause.
          return denied(error.code);
        }
        if (status === 409 || status === 412) return denied("CONFLICT");
        if (status === 404) return denied("NOT_FOUND");
        await close();
        if (mutation && started) return denied("UNKNOWN_OUTCOME");
        return denied(error instanceof SupabaseStorageError ? error.code : "UNAVAILABLE");
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (onAbort) controller.signal.removeEventListener("abort", onAbort);
        active = undefined;
        busy = false;
      }
    },
  };
}

export function createSupabaseBasicStore(config: SupabaseStorageConfig, port: SupabaseBasicPort,
  options?: OperationOptions) {
  config = snapshotSupabaseStorageConfig(config);
  assertSupabaseBinding(config, port);
  const boundary = createSupabaseBoundary(() => port.cancelAndClose(), options);
  return {
    config, boundary,
    async head(key: string, signal?: AbortSignal) {
      supabaseAssetKey(config, key);
      return boundary.run(false, async s => {
        const value = await port.info(key, s);
        return value === null ? null : validateBasicMetadata(value);
      }, signal);
    },
    async create(key: string, bytes: Buffer, mimeType: string, signal?: AbortSignal, metadata?: ObjectWriteMetadata) {
      supabaseAssetKey(config, key); validateBytes(bytes, mimeType);
      const copy = Buffer.from(bytes);
      const mapped = validateWriteMetadata(metadata ?? {
        mimeType, cacheControl: key.startsWith(`${config.privateRoot}/`) ? "private, no-store" : "no-store", custom: {},
      });
      if (mapped.mimeType !== mimeType) denied("INVALID_INPUT");
      return boundary.run(true, s => port.upload(key, copy, {
        upsert: false, contentType: mimeType, cacheControl: "0",
        // Semantic metadata is separate from SDK numeric cache-control options.
        metadata: { ...mapped, visibility: key.startsWith(`${config.privateRoot}/`) ? "private" : "api-mediated" },
      }, s), signal);
    },
    /** Basic download only: deliberately NOT an ObjectStore generation-pinned read. */
    async download(key: string, signal?: AbortSignal) {
      supabaseAssetKey(config, key);
      return boundary.run(false, async s => {
        const result = await port.download(key, s);
        validateBytes(result.bytes, result.mimeType);
        return { bytes: Buffer.from(result.bytes), mimeType: result.mimeType };
      }, signal);
    },
  };
}
export type SupabaseBasicStore = ReturnType<typeof createSupabaseBasicStore>;
