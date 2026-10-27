import type { ObjectStore, ObjectWriteMetadata } from "./object-store.js";
import { safeObjectKey, referenceRoot } from "./object-store.js";
import { externalGcsConfig } from "./external-gcs-config.js";
import { externalGcsObjectStore } from "./external-gcs.js";

/**
 * Legacy references are logical keys, NOT bucket selectors. Retain the complete
 * normalized legacy path inside the explicitly configured destination bucket.
 */
export function createExternalAssets(store: ObjectStore, roots: { privateRoot: string; publicRoot: string }) {
  const privateRoot = referenceRoot(roots.privateRoot);
  const publicRoot = referenceRoot(roots.publicRoot);
  if (privateRoot === publicRoot || privateRoot.startsWith(`${publicRoot}/`) ||
      publicRoot.startsWith(`${privateRoot}/`)) {
    throw new Error("External asset namespaces must be disjoint.");
  }
  const metadata = (mimeType: string, privateFile: boolean): ObjectWriteMetadata => ({
    mimeType, cacheControl: privateFile ? "private, no-store" : "no-store",
    custom: { visibility: privateFile ? "private" : "published-product" },
  });
  const discard = async (key: string) => {
    const current = await store.head(key);
    if (current) await store.remove(key, current.generation);
  };
  function privateArea(area: "vendor-documents" | "delivery-photos") {
    const key = (ref: string) => {
      const value = referenceRoot(ref);
      if (!value.startsWith(`${privateRoot}/${area}/`) ||
          value.slice(`${privateRoot}/${area}/`.length).split("/").length !== 2) {
        throw new Error("Private object reference is outside its allowed namespace.");
      }
      return value;
    };
    return {
      put: (ref: string, bytes: Buffer, mimeType: string) =>
        store.write(key(ref), bytes, metadata(mimeType, true), 0),
      get: async (ref: string) => (await store.read(key(ref))).bytes,
      discard: (ref: string) => discard(key(ref)),
    };
  }
  const productKey = (storeId: string, imageId: string) => {
    safeObjectKey(storeId); safeObjectKey(imageId);
    if (storeId.includes("/") || imageId.includes("/")) throw new Error("Invalid image identifier.");
    return safeObjectKey(`${publicRoot}/product-images/${storeId}/${imageId}`);
  };
  const brandingKey = safeObjectKey(`${publicRoot}/application-branding/active-logo`);
  return {
    documents: privateArea("vendor-documents"),
    photos: privateArea("delivery-photos"),
    products: {
      put: (storeId: string, imageId: string, bytes: Buffer, mimeType: string) =>
        store.write(productKey(storeId, imageId), bytes, metadata(mimeType, false), 0),
      get: async (storeId: string, imageId: string) => {
        const object = await store.read(productKey(storeId, imageId));
        return { bytes: object.bytes, mimeType: object.metadata.mimeType };
      },
      discard: (storeId: string, imageId: string) => discard(productKey(storeId, imageId)),
    },
    branding: {
      async metadata() {
        const current = await store.head(brandingKey);
        return current ? { revision: current.generation, mimeType: current.mimeType } : null;
      },
      async put(bytes: Buffer, mimeType: string) {
        if (!["image/png", "image/jpeg"].includes(mimeType)) throw new Error("Unsupported logo MIME type.");
        const current = await store.head(brandingKey);
        await store.write(brandingKey, bytes, { ...metadata(mimeType, false), custom: {} }, current?.generation ?? 0);
      },
      async get() {
        const object = await store.read(brandingKey);
        return { bytes: object.bytes, mimeType: object.metadata.mimeType };
      },
    },
  };
}

let assets: Promise<ReturnType<typeof createExternalAssets>> | undefined;
export function getExternalAssets() {
  if (process.env.API_OBJECT_STORAGE_PROVIDER !== "external-gcs") {
    throw new Error("External GCS is not explicitly selected.");
  }
  const config = externalGcsConfig(process.env);
  return assets ??= externalGcsObjectStore(process.env).then(
    store => createExternalAssets(store, config),
  );
}
