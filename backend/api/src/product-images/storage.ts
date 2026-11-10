import { Storage } from "@google-cloud/storage";
import { getExternalAssets } from "../storage/external-assets.js";
import { getSupabaseAssets } from "../storage/supabase-assets.js";
import { getSupabaseLiveAssets } from "../storage/supabase-live-assets.js";
import { readWithNotFoundFallback, discardFromOwningStore } from "../storage/asset-storage-fallback.js";
import { assertStorageOperationsEnabled, getApiAssetStorageProvider, getApiObjectStorageProvider } from "../storage/provider.js";
import {
  createProductImageStorageAdapter,
  getReplitObjectStore,
} from "../storage/replit-object-storage.js";

// Reuse App Storage / its sidecar; separate customer-visible image prefix.
// Never touch PRIVATE_OBJECT_DIR or the vendor-documents namespace.
const storage = getApiObjectStorageProvider() === "replit-gcs-sidecar" ? new Storage({
  projectId: "",
  credentials: {
    type: "external_account", audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
}) : undefined;
function file(storeId: string, imageId: string) {
  const directory = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.split(",").map(item => item.trim().replace(/\/$/, "")).find(Boolean);
  if (!directory) throw new Error("Product image storage is not configured");
  const parts = directory.replace(/^\//, "").split("/");
  if (!storage) throw new Error("The Replit GCS sidecar provider is not active.");
  return storage.bucket(parts.shift()!).file([...parts, "product-images", storeId, imageId].join("/"));
}
async function appStorage() {
  return createProductImageStorageAdapter(
    await getReplitObjectStore(),
    () => process.env.PUBLIC_OBJECT_SEARCH_PATHS,
  );
}
export const productImageStorage = {
  async put(storeId: string, imageId: string, bytes: Buffer, mimeType: string) {
    assertStorageOperationsEnabled();
    if (getApiAssetStorageProvider() === "supabase-storage") {
      return getSupabaseLiveAssets().products.put(storeId, imageId, bytes, mimeType);
    }
    if (getApiObjectStorageProvider() === "supabase-storage") {
      return getSupabaseAssets().products.put(storeId, imageId, bytes, mimeType);
    }
    if (getApiObjectStorageProvider() === "external-gcs") {
      return (await getExternalAssets()).products.put(storeId, imageId, bytes, mimeType);
    }
    if (getApiObjectStorageProvider() === "replit-app-storage") {
      await (await appStorage()).put(storeId, imageId, bytes, mimeType);
      return;
    }
    await file(storeId, imageId).save(bytes, { resumable: false, validation: "crc32c",
      metadata: { contentType: mimeType, cacheControl: "no-store", metadata: { visibility: "published-product" } } });
  },
  async get(storeId: string, imageId: string) {
    assertStorageOperationsEnabled();
    if (getApiAssetStorageProvider() === "supabase-storage") {
      const products = getSupabaseLiveAssets().products;
      return readWithNotFoundFallback(
        () => products.get(storeId, imageId),
        async () => {
          if (getApiObjectStorageProvider() === "supabase-storage") {
            return getSupabaseAssets().products.get(storeId, imageId);
          }
          if (getApiObjectStorageProvider() === "external-gcs") {
            return (await getExternalAssets()).products.get(storeId, imageId);
          }
          if (getApiObjectStorageProvider() === "replit-app-storage") {
            return (await appStorage()).get(storeId, imageId);
          }
          const object = file(storeId, imageId);
          const [metadata] = await object.getMetadata();
          const [bytes] = await object.download();
          return { bytes, mimeType: metadata.contentType ?? "application/octet-stream" };
        },
      );
    }
    if (getApiObjectStorageProvider() === "supabase-storage") {
      return getSupabaseAssets().products.get(storeId, imageId);
    }
    if (getApiObjectStorageProvider() === "external-gcs") {
      return (await getExternalAssets()).products.get(storeId, imageId);
    }
    if (getApiObjectStorageProvider() === "replit-app-storage") {
      return (await appStorage()).get(storeId, imageId);
    }
    const object = file(storeId, imageId);
    const [metadata] = await object.getMetadata();
    const [bytes] = await object.download();
    return { bytes, mimeType: metadata.contentType ?? "application/octet-stream" };
  },
  async discard(storeId: string, imageId: string) {
    assertStorageOperationsEnabled();
    if (getApiAssetStorageProvider() === "supabase-storage") {
      const products = getSupabaseLiveAssets().products;
      return discardFromOwningStore(
        () => products.has(storeId, imageId),
        () => products.discard(storeId, imageId),
        async () => {
          if (getApiObjectStorageProvider() === "supabase-storage") {
            return getSupabaseAssets().products.discard(storeId, imageId);
          }
          if (getApiObjectStorageProvider() === "external-gcs") {
            return (await getExternalAssets()).products.discard(storeId, imageId);
          }
          if (getApiObjectStorageProvider() === "replit-app-storage") {
            await (await appStorage()).discard(storeId, imageId);
            return;
          }
          await file(storeId, imageId).delete({ ignoreNotFound: true });
        },
      );
    }
    if (getApiObjectStorageProvider() === "supabase-storage") {
      return getSupabaseAssets().products.discard(storeId, imageId);
    }
    if (getApiObjectStorageProvider() === "external-gcs") {
      return (await getExternalAssets()).products.discard(storeId, imageId);
    }
    if (getApiObjectStorageProvider() === "replit-app-storage") {
      await (await appStorage()).discard(storeId, imageId);
      return;
    }
    await file(storeId, imageId).delete({ ignoreNotFound: true });
  },
};
