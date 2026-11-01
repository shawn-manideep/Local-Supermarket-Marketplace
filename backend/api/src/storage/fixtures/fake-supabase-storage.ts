import type { ObjectMetadata, ObjectWriteMetadata } from "../object-store.js";
import type { SupabaseStorageConfig } from "../supabase-storage-config.js";
import type { SupabaseBasicPort } from "../supabase-storage.js";
import type { SupabaseConcurrencyCapabilities } from "../supabase-concurrency.js";
import { supabaseStorageConfig } from "../supabase-storage-config.js";

export function syntheticSupabaseEnv() {
  return {
    API_OBJECT_STORAGE_PROVIDER: "supabase-storage",
    SUPABASE_URL: "https://nrnigsznectrgbgafwme.supabase.co",
    SUPABASE_STORAGE_BUCKET: "fixture-assets",
    SUPABASE_STORAGE_PUBLIC_REFERENCE_ROOT: "legacy-fixture/public",
    SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT: "legacy-fixture/private",
    PUBLIC_OBJECT_SEARCH_PATHS: "/legacy-fixture/public",
    PRIVATE_OBJECT_DIR: "/legacy-fixture/private",
  };
}
export const fixtureSupabaseConfig = () => supabaseStorageConfig(syntheticSupabaseEnv());

/** In-memory fixture only. No SDK, environment, credentials, network or files. */
export class FakeSupabaseStorage implements SupabaseBasicPort {
  readonly projectRef: string;
  readonly bucket: string;
  readonly privateBucket = true;
  readonly objects = new Map<string, { bytes: Buffer; metadata: ObjectMetadata }>();
  readonly versions = new Map<string, { bytes: Buffer; metadata: ObjectMetadata }>();
  readonly operations: Array<{ operation: string; key?: string; revision?: string }> = [];
  sequence = 0;
  closes = 0;
  fail?: { operation: string; statusCode?: number; message?: string; afterCommit?: boolean };
  stall?: string;
  rejectCleanup = false;
  stallCleanup = false;
  lastSignal?: AbortSignal;
  beforeRead?: () => void;
  constructor(config: SupabaseStorageConfig) {
    this.projectRef = config.projectRef;
    this.bucket = config.bucket;
  }
  private async begin(operation: string, key: string, signal: AbortSignal) {
    this.operations.push({ operation, key });
    this.lastSignal = signal;
    if (this.stall === operation) await new Promise<void>(() => {});
    if (signal.aborted) throw new Error("fixture aborted");
    if (this.fail?.operation === operation && !this.fail.afterCommit) {
      throw { statusCode: this.fail.statusCode, message: this.fail.message ?? "fixture provider failure" };
    }
  }
  seed(key: string, bytes: Buffer, mimeType: string, extra?: ObjectWriteMetadata) {
    const metadata = { ...(extra ?? { mimeType, cacheControl: "no-store", custom: {} }),
      generation: `fixture_${++this.sequence}` };
    const object = { bytes: Buffer.from(bytes), metadata };
    this.objects.set(key, object);
    this.versions.set(`${key}@${metadata.generation}`, structuredClone(object) as typeof object);
  }
  async info(key: string, signal: AbortSignal) {
    await this.begin("info", key, signal);
    const object = this.objects.get(key);
    if (!object) return null;
    const { generation, ...metadata } = object.metadata;
    return { ...metadata, revision: generation, size: object.bytes.length };
  }
  async upload(key: string, bytes: Buffer, options: Parameters<SupabaseBasicPort["upload"]>[2], signal: AbortSignal) {
    await this.begin("upload", key, signal);
    if (options.upsert !== false || options.cacheControl !== "0") throw new Error("unsafe options");
    if (this.objects.has(key)) throw { statusCode: 409, message: "fixture duplicate" };
    const { visibility: _visibility, ...metadata } = options.metadata;
    this.seed(key, bytes, options.contentType, metadata as unknown as ObjectWriteMetadata);
    if (this.fail?.operation === "upload" && this.fail.afterCommit) throw { message: this.fail.message };
  }
  async download(key: string, signal: AbortSignal) {
    await this.begin("download", key, signal);
    const object = this.objects.get(key);
    if (!object) throw { statusCode: 404 };
    return { bytes: Buffer.from(object.bytes), mimeType: object.metadata.mimeType };
  }
  async cancelAndClose() {
    this.closes++;
    if (this.stallCleanup) await new Promise<void>(() => {});
    if (this.rejectCleanup) throw new Error("fixture cleanup failed");
  }
  readonly capabilities: SupabaseConcurrencyCapabilities = {
    get projectRef() { return this.fixture.projectRef; },
    get bucket() { return this.fixture.bucket; },
    privateBucket: true,
    fixture: this,
    readAtRevision: async (key: string, revision: string, signal: AbortSignal) => {
      await this.begin("read-revision", key, signal);
      this.beforeRead?.();
      const object = this.versions.get(`${key}@${revision}`);
      if (!object) throw { statusCode: 409 };
      return { bytes: Buffer.from(object.bytes), metadata: structuredClone(object.metadata) };
    },
    replaceIfRevision: async (key: string, bytes: Buffer, metadata: ObjectWriteMetadata, revision: string, signal: AbortSignal) => {
      await this.begin("replace-revision", key, signal);
      this.operations.at(-1)!.revision = revision;
      if (this.objects.get(key)?.metadata.generation !== revision) throw { statusCode: 412 };
      this.seed(key, bytes, metadata.mimeType, metadata);
      if (this.fail?.operation === "replace-revision" && this.fail.afterCommit) throw {};
    },
    deleteIfRevision: async (key: string, revision: string, signal: AbortSignal) => {
      await this.begin("delete-revision", key, signal);
      this.operations.at(-1)!.revision = revision;
      if (this.objects.get(key)?.metadata.generation !== revision) throw { statusCode: 412 };
      this.objects.delete(key);
      if (this.fail?.operation === "delete-revision" && this.fail.afterCommit) throw {};
    },
  } as SupabaseConcurrencyCapabilities & { fixture: FakeSupabaseStorage };
}
