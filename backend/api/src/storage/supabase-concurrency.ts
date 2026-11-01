import type { ObjectMetadata, ObjectStore, ObjectWriteMetadata } from "./object-store.js";
import {
  assertSupabaseBinding, supabaseAssetKey, SupabaseStorageError, validRevision,
  validateBasicMetadata, validateBytes, validateWriteMetadata, type SupabaseBasicStore, type SupabaseFixtureBinding,
} from "./supabase-storage.js";

/** Fixture contract, not a claim that the hosted Supabase service implements CAS.
 * No native SDK implementation is supplied or inferred from custom headers.
 */
export interface SupabaseConcurrencyCapabilities extends SupabaseFixtureBinding {
  readAtRevision?(key: string, revision: string, signal: AbortSignal): Promise<{
    bytes: Buffer; metadata: ObjectMetadata;
  }>;
  replaceIfRevision?(key: string, bytes: Buffer, metadata: ObjectWriteMetadata,
    revision: string, signal: AbortSignal): Promise<void>;
  deleteIfRevision?(key: string, revision: string, signal: AbortSignal): Promise<void>;
}
const unsupported = (): never => { throw new SupabaseStorageError("CAPABILITY_UNAVAILABLE"); };

/** Fail closed per operation. A basic client alone cannot satisfy ObjectStore. */
export function createSupabaseObjectStore(basic: SupabaseBasicStore,
  capabilities?: SupabaseConcurrencyCapabilities): ObjectStore {
  if (capabilities) assertSupabaseBinding(basic.config, capabilities);
  return {
    async head(key) {
      const metadata = await basic.head(key);
      if (!metadata) return null;
      if (!metadata.revision) return unsupported();
      return {
        generation: metadata.revision, mimeType: metadata.mimeType,
        cacheControl: metadata.cacheControl ?? "no-store", custom: metadata.custom ?? {},
        ...(metadata.contentDisposition === undefined ? {} : { contentDisposition: metadata.contentDisposition }),
        ...(metadata.contentEncoding === undefined ? {} : { contentEncoding: metadata.contentEncoding }),
        ...(metadata.contentLanguage === undefined ? {} : { contentLanguage: metadata.contentLanguage }),
      };
    },
    async read(key) {
      supabaseAssetKey(basic.config, key);
      if (!capabilities?.readAtRevision) return unsupported();
      const metadata = await this.head(key);
      if (!metadata) throw new SupabaseStorageError("NOT_FOUND");
      return basic.boundary.run(false, async signal => {
        const result = await capabilities.readAtRevision!(key, metadata.generation, signal);
        validateBytes(result.bytes, result.metadata.mimeType);
        validateBasicMetadata({ mimeType: result.metadata.mimeType, size: result.bytes.length,
          revision: result.metadata.generation });
        if (result.metadata.generation !== metadata.generation || result.metadata.mimeType !== metadata.mimeType)
          throw new SupabaseStorageError("CONFLICT");
        return { bytes: Buffer.from(result.bytes), metadata: {
          ...metadata, mimeType: result.metadata.mimeType,
        } };
      });
    },
    async write(key, bytes, metadata, generation) {
      supabaseAssetKey(basic.config, key); validateBytes(bytes, metadata.mimeType);
      const mapped = validateWriteMetadata(metadata);
      if (generation === 0) return basic.create(key, bytes, mapped.mimeType, undefined, mapped);
      validRevision(generation);
      if (!capabilities?.replaceIfRevision) return unsupported();
      const copy = Buffer.from(bytes);
      return basic.boundary.run(true, signal =>
        capabilities.replaceIfRevision!(key, copy, mapped, generation, signal));
    },
    async remove(key, generation) {
      supabaseAssetKey(basic.config, key); validRevision(generation);
      if (!capabilities?.deleteIfRevision) return unsupported();
      return basic.boundary.run(true, signal => capabilities.deleteIfRevision!(key, generation, signal));
    },
  };
}
