import { Storage } from "@google-cloud/storage";
import { getExternalAssets } from "../storage/external-assets.js";
import { getSupabaseAssets } from "../storage/supabase-assets.js";
import { getR2Assets } from "../storage/r2-assets.js";
import { getSupabaseLiveAssets } from "../storage/supabase-live-assets.js";
import { SupabaseStorageError } from "../storage/supabase-storage.js";
import { readWithNotFoundFallback, discardFromOwningStore } from "../storage/asset-storage-fallback.js";
import { assertStorageOperationsEnabled, getApiAssetStorageProvider, getApiObjectStorageProvider, getApiVendorDocumentStorageProvider } from "../storage/provider.js";
import {
  createPrivateObjectStorageAdapter,
  getReplitObjectStore,
} from "../storage/replit-object-storage.js";

// Replit sidecar credentials: no user secrets or public storage endpoints.
const storage = getApiObjectStorageProvider() === "replit-gcs-sidecar" ? new Storage({
  projectId: "",
  credentials: {
    type: "external_account", audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
}) : undefined;
function file(ref: string, area: "vendor-documents" | "delivery-photos") {
  const directory = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "");
  if (!directory || !ref.startsWith(`${directory}/${area}/`)) throw new Error("Invalid private object reference");
  const parts = ref.replace(/^\//, "").split("/");
  if (!storage) throw new Error("The Replit GCS sidecar provider is not active.");
  return storage.bucket(parts.shift()!).file(parts.join("/"));
}
async function appStorage(area: "vendor-documents" | "delivery-photos") {
  return createPrivateObjectStorageAdapter(
    area,
    await getReplitObjectStore(),
    () => process.env.PRIVATE_OBJECT_DIR,
  );
}
async function readLegacyPrivateObject(area: "vendor-documents" | "delivery-photos", ref: string) {
  // Even an explicit missing Supabase document cannot enable a disabled source.
  assertStorageOperationsEnabled();
  if (getApiObjectStorageProvider() === "supabase-storage") {
    const legacy = getSupabaseAssets();
    return (area === "vendor-documents" ? legacy.documents : legacy.photos).get(ref);
  }
  if (getApiObjectStorageProvider() === "external-gcs") {
    const legacy = await getExternalAssets();
    return (area === "vendor-documents" ? legacy.documents : legacy.photos).get(ref);
  }
  if (getApiObjectStorageProvider() === "replit-app-storage") {
    return (await appStorage(area)).get(ref);
  }
  return (await file(ref, area).download())[0];
}
export const privateObjectStorage = (area: "vendor-documents" | "delivery-photos") => ({
  async put(ref: string, bytes: Buffer, mimeType: string) {
    if (area === "vendor-documents" && getApiVendorDocumentStorageProvider() === "supabase-storage") {
      return getSupabaseLiveAssets().documents.put(ref, bytes, mimeType);
    }
    assertStorageOperationsEnabled();
    if (getApiObjectStorageProvider() === "cloudflare-r2") {
      const assets = getR2Assets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).put(ref, bytes, mimeType);
    }
    if (getApiAssetStorageProvider() === "supabase-storage") {
      const assets = getSupabaseLiveAssets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).put(ref, bytes, mimeType);
    }
    if (getApiObjectStorageProvider() === "supabase-storage") {
      const assets = getSupabaseAssets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).put(ref, bytes, mimeType);
    }
    if (getApiObjectStorageProvider() === "external-gcs") {
      const assets = await getExternalAssets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).put(ref, bytes, mimeType);
    }
    if (getApiObjectStorageProvider() === "replit-app-storage") {
      await (await appStorage(area)).put(ref, bytes);
      return;
    }
    await file(ref, area).save(bytes, { resumable: false, validation: "crc32c",
      metadata: { contentType: mimeType, cacheControl: "private, no-store",
        metadata: { visibility: "private" } } });
  },
  async get(ref: string) {
    if (area === "vendor-documents" && getApiVendorDocumentStorageProvider() === "supabase-storage") {
      const documents = getSupabaseLiveAssets().documents;
      if (getApiObjectStorageProvider() === "disabled") return documents.get(ref);
      return readWithNotFoundFallback(
        () => documents.get(ref),
        () => readLegacyPrivateObject(area, ref),
      );
    }
    assertStorageOperationsEnabled();
    if (getApiObjectStorageProvider() === "cloudflare-r2") {
      const assets = getR2Assets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).get(ref);
    }
    if (getApiAssetStorageProvider() === "supabase-storage") {
      const assets = getSupabaseLiveAssets();
      const selected = area === "vendor-documents" ? assets.documents : assets.photos;
      return readWithNotFoundFallback(
        () => selected.get(ref),
        () => readLegacyPrivateObject(area, ref),
      );
    }
    if (getApiObjectStorageProvider() === "supabase-storage") {
      const assets = getSupabaseAssets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).get(ref);
    }
    if (getApiObjectStorageProvider() === "external-gcs") {
      const assets = await getExternalAssets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).get(ref);
    }
    if (getApiObjectStorageProvider() === "replit-app-storage") {
      return (await appStorage(area)).get(ref);
    }
    return (await file(ref, area).download())[0];
  },
  async discard(ref: string) {
    if (area === "vendor-documents" && getApiVendorDocumentStorageProvider() === "supabase-storage") {
      throw new SupabaseStorageError("CAPABILITY_UNAVAILABLE");
    }
    assertStorageOperationsEnabled();
    if (getApiObjectStorageProvider() === "cloudflare-r2") {
      const assets = getR2Assets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).discard(ref);
    }
    if (getApiAssetStorageProvider() === "supabase-storage") {
      // Document erasure has no established conditional ownership guarantee.
      // Deny before inspection: absence must never cause legacy deletion.
      if (area === "vendor-documents") throw new SupabaseStorageError("CAPABILITY_UNAVAILABLE");
      const assets = getSupabaseLiveAssets();
      const selected = assets.photos;
      return discardFromOwningStore(
        () => selected.has(ref),
        () => selected.discard(ref),
        async () => {
          if (getApiObjectStorageProvider() === "supabase-storage") {
            const legacy = getSupabaseAssets();
            return legacy.photos.discard(ref);
          }
          if (getApiObjectStorageProvider() === "external-gcs") {
            const legacy = await getExternalAssets();
            return legacy.photos.discard(ref);
          }
          if (getApiObjectStorageProvider() === "replit-app-storage") {
            await (await appStorage(area)).discard(ref);
            return;
          }
          await file(ref, area).delete({ ignoreNotFound: true });
        },
      );
    }
    if (getApiObjectStorageProvider() === "supabase-storage") {
      const assets = getSupabaseAssets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).discard(ref);
    }
    if (getApiObjectStorageProvider() === "external-gcs") {
      const assets = await getExternalAssets();
      return (area === "vendor-documents" ? assets.documents : assets.photos).discard(ref);
    }
    if (getApiObjectStorageProvider() === "replit-app-storage") {
      await (await appStorage(area)).discard(ref);
      return;
    }
    await file(ref, area).delete({ ignoreNotFound: true });
  },
});
export const documentStorage = privateObjectStorage("vendor-documents");
