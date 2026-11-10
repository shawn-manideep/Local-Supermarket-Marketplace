import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { referenceRoot } from "./object-store.js";
import { snapshotSupabaseStorageConfig, type SupabaseStorageConfig } from "./supabase-storage-config.js";
import { SupabaseStorageError } from "./supabase-storage.js";
import { validateLiveAssetBytes } from "./live-asset-validation.js";

type Client = Pick<SupabaseClient, "storage">;
const MAX_BYTES = 5 * 1024 * 1024;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const unavailable = () => new SupabaseStorageError("UNAVAILABLE");

/** Document-only SDK fetch: one dispatch, no redirects/retries, bounded bodies.
 * A fresh instance belongs to one operation, never to a shared caller signal.
 */
export function documentFetch(signal: AbortSignal, transport: typeof fetch = globalThis.fetch): typeof fetch {
  let requests = 0;
  let mutations = 0;
  return async (input, init) => {
    if (signal.aborted) throw unavailable();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!["POST", "GET", "HEAD"].includes(method) || ++requests > 2 ||
      (method === "POST" && ++mutations > 1)) throw unavailable();
    const response = await transport(input, { ...init, signal, redirect: "error" });
    if (signal.aborted) {
      await response.body?.cancel().catch(() => undefined);
      throw unavailable();
    }
    const reader = response.body?.getReader();
    if (!reader) return response;
    const chunks: Uint8Array[] = [];
    let size = 0;
    let finished = false;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        if (signal.aborted) throw unavailable();
        const result = await reader.read();
        if (signal.aborted) throw unavailable();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > MAX_BYTES) throw unavailable();
        chunks.push(result.value);
      }
      finished = true;
      return new Response(Uint8Array.from(Buffer.concat(chunks)), {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } finally {
      signal.removeEventListener("abort", cancel);
      // Do not await a potentially stuck provider stream during cleanup.
      if (!finished) cancel();
      reader.releaseLock();
    }
  };
}

function failure(error: unknown, mutation: boolean): never {
  if (error instanceof SupabaseStorageError) throw error;
  let status: number | undefined;
  let code: unknown;
  try {
    if (typeof error === "object" && error !== null) {
      const value = error as Record<string, unknown>;
      const raw = value.status ?? value.statusCode;
      if (typeof raw === "number" || (typeof raw === "string" && /^\d{3}$/.test(raw))) status = Number(raw);
      code = value.code;
    }
  } catch { /* Untrusted provider properties never escape. */ }
  if (status === 409 || status === 412) throw new SupabaseStorageError("CONFLICT");
  // Only explicit object absence may enable the existing legacy read fallback.
  if (!mutation && status === 404 && code === "NoSuchKey") throw new SupabaseStorageError("NOT_FOUND");
  if (mutation && (status === undefined || status >= 500)) throw new SupabaseStorageError("UNKNOWN_OUTCOME");
  throw unavailable();
}

/** Immutable Vendor documents only. No revision/CAS or physical-delete claim. */
export function createSupabaseVendorDocuments(
  clientForSignal: (signal: AbortSignal) => Client,
  input: SupabaseStorageConfig,
  options: { timeoutMs?: number } = {},
) {
  const config = snapshotSupabaseStorageConfig(input);
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) {
    throw new SupabaseStorageError("INVALID_INPUT");
  }
  function key(ref: string) {
    try {
      const value = referenceRoot(ref);
      const prefix = `${config.privateRoot}/vendor-documents/`;
      if (!value.startsWith(prefix)) throw new Error();
      const parts = value.slice(prefix.length).split("/");
      if (parts.length !== 2 || parts.some(part => !/^[a-zA-Z0-9_-]{1,128}$/.test(part))) throw new Error();
      return value;
    } catch { throw new SupabaseStorageError("INVALID_INPUT"); }
  }
  async function operation<T>(
    work: (bucket: ReturnType<Client["storage"]["from"]>, check: () => void, dispatched: () => void) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let mutationStarted = false;
    const timedOut = () => new SupabaseStorageError(mutationStarted ? "UNKNOWN_OUTCOME" : "TIMEOUT");
    const check = () => { if (controller.signal.aborted) throw timedOut(); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Reject with the conservative category before aborting SDK work.
        reject(timedOut());
        controller.abort();
      }, timeoutMs);
    });
    try {
      const bucket = clientForSignal(controller.signal).storage.from(config.bucket);
      return await Promise.race([
        work(bucket, check, () => { check(); mutationStarted = true; }),
        deadline,
      ]);
    } catch (error) {
      if (controller.signal.aborted) throw timedOut();
      failure(error, mutationStarted);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  async function read(bucket: ReturnType<Client["storage"]["from"]>, path: string, check: () => void) {
    check();
    const { data, error } = await bucket.download(path);
    check();
    if (error || !data) failure(error, false);
    if (!data || data.size < 1 || data.size > MAX_BYTES) throw unavailable();
    const bytes = Buffer.from(await data.arrayBuffer());
    check();
    try { validateLiveAssetBytes(bytes, data.type); }
    catch { throw unavailable(); }
    return { bytes, mimeType: data.type };
  }
  return {
    async put(ref: string, bytes: Buffer, mimeType: string) {
      const path = key(ref);
      if (!["application/pdf", "image/jpeg", "image/png"].includes(mimeType)) {
        throw new SupabaseStorageError("INVALID_INPUT");
      }
      const snapshot = Buffer.from(bytes);
      validateLiveAssetBytes(snapshot, mimeType);
      const expected = digest(snapshot);
      return operation(async (bucket, check, dispatched) => {
        dispatched();
        const { error } = await bucket.upload(path, snapshot, {
          upsert: false, contentType: mimeType, cacheControl: "0",
          metadata: { visibility: "private" },
        });
        check();
        if (error) failure(error, true);
        // Any verification failure retains the object. Never fall back or erase.
        let actual: Awaited<ReturnType<typeof read>>;
        try { actual = await read(bucket, path, check); }
        catch (error) {
          if (error instanceof SupabaseStorageError && error.code === "NOT_FOUND") throw unavailable();
          throw error;
        }
        if (actual.bytes.length !== snapshot.length || digest(actual.bytes) !== expected || actual.mimeType !== mimeType) {
          throw unavailable();
        }
      });
    },
    async get(ref: string) {
      const path = key(ref);
      return operation(async (bucket, check) => (await read(bucket, path, check)).bytes);
    },
    async has(ref: string) {
      const path = key(ref);
      return operation(async (bucket, check) => {
        check();
        const { data, error } = await bucket.info(path);
        check();
        if (error) {
          try { failure(error, false); }
          catch (safe) {
            if (safe instanceof SupabaseStorageError && safe.code === "NOT_FOUND") return false;
            throw safe;
          }
        }
        // A malformed successful response is not evidence of absence.
        if (!data) throw unavailable();
        return true;
      });
    },
    async discard(ref: string): Promise<never> {
      key(ref);
      throw new SupabaseStorageError("CAPABILITY_UNAVAILABLE");
    },
  };
}
