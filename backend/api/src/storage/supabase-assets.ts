import type { ObjectStore } from "./object-store.js";
import { referenceRoot, safeObjectKey } from "./object-store.js";
import { snapshotSupabaseStorageConfig, type SupabaseStorageConfig } from "./supabase-storage-config.js";
import { SupabaseStorageError, validateBytes } from "./supabase-storage.js";

/** Storage only. Existing API routes remain responsible for authorization. */
export function createSupabaseAssets(store: ObjectStore, config: SupabaseStorageConfig) {
  config = snapshotSupabaseStorageConfig(config);
  const segment = (value: string) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new SupabaseStorageError("INVALID_INPUT");
    return value;
  };
  const discard = async (key: string) => {
    const current = await store.head(key);
    if (current) await store.remove(key, current.generation);
  };
  function privateArea(area: "vendor-documents" | "delivery-photos") {
    const key = (ref: string) => {
      try {
        const value = referenceRoot(ref), prefix = `${config.privateRoot}/${area}/`;
        if (!value.startsWith(prefix)) throw new Error();
        const parts = value.slice(prefix.length).split("/");
        if (parts.length !== 2) throw new Error();
        parts.forEach(segment);
        return value;
      } catch { throw new SupabaseStorageError("INVALID_INPUT"); }
    };
    return {
      async put(ref: string, bytes: Buffer, mimeType: string) {
        if (!(area === "delivery-photos" ? ["image/png", "image/jpeg"] : ["image/png", "image/jpeg", "application/pdf"]).includes(mimeType))
          throw new SupabaseStorageError("INVALID_INPUT");
        validateBytes(bytes, mimeType);
        return store.write(key(ref), bytes, { mimeType, cacheControl: "private, no-store", custom: { visibility: "private" } }, 0);
      },
      get: async (ref: string) => (await store.read(key(ref))).bytes,
      discard: (ref: string) => discard(key(ref)),
    };
  }
  const productKey = (store: string, image: string) =>
    safeObjectKey(`${config.publicRoot}/product-images/${segment(store)}/${segment(image)}`);
  const brandingKey = `${config.publicRoot}/application-branding/active-logo`;
  return {
    documents: privateArea("vendor-documents"),
    photos: privateArea("delivery-photos"),
    products: {
      async put(storeId: string, imageId: string, bytes: Buffer, mimeType: string) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw new SupabaseStorageError("INVALID_INPUT");
        validateBytes(bytes, mimeType);
        return store.write(productKey(storeId, imageId), bytes, { mimeType, cacheControl: "no-store", custom: {} }, 0);
      },
      async get(storeId: string, imageId: string) {
        const value = await store.read(productKey(storeId, imageId));
        return { bytes: value.bytes, mimeType: value.metadata.mimeType };
      },
      discard: (storeId: string, imageId: string) => discard(productKey(storeId, imageId)),
    },
    branding: {
      async metadata() {
        const current = await store.head(brandingKey);
        return current ? { revision: current.generation, mimeType: current.mimeType } : null;
      },
      async put(bytes: Buffer, mimeType: string) {
        if (!["image/png", "image/jpeg"].includes(mimeType) || bytes.length > 2 * 1024 * 1024)
          throw new SupabaseStorageError("INVALID_INPUT");
        validateBytes(bytes, mimeType);
        const current = await store.head(brandingKey);
        return store.write(brandingKey, bytes, { mimeType, cacheControl: "no-store", custom: {} }, current?.generation ?? 0);
      },
      async get() {
        const value = await store.read(brandingKey);
        return { bytes: value.bytes, mimeType: value.metadata.mimeType };
      },
    },
  };
}

/** No installer, client factory, credentials or environment switch unlocks this. */
export function getSupabaseAssets(): ReturnType<typeof createSupabaseAssets> {
  throw new SupabaseStorageError("LIVE_OPERATIONS_DISABLED");
}
