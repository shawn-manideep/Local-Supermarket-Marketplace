import { createExternalAssets } from "./external-assets.js";
import { r2Config } from "./r2-config.js";
import { R2Error, r2ObjectStore, type R2Transport } from "./r2-store.js";
import { r2Transport } from "./r2-transport.js";
import { getApiDeliveryPhotoStorageProvider } from "./provider.js";
import type { R2Config } from "./r2-config.js";

export function createR2Assets(transport: R2Transport, scope: {
  publicRoot: string; privateRoot: string; prefix: string;
}) {
  return createExternalAssets(r2ObjectStore(transport, scope), scope);
}

let assets: ReturnType<typeof createR2Assets> | undefined;
export function getR2Assets() {
  if (process.env.API_OBJECT_STORAGE_PROVIDER !== "cloudflare-r2") {
    throw new Error("Cloudflare R2 is not explicitly selected.");
  }
  const config = r2Config(process.env);
  return assets ??= createR2Assets(r2Transport(config), config);
}

/** Expose only photos, with a second namespace boundary inside the object store. */
export function createR2DeliveryPhotoAssets(
  transport: R2Transport,
  scope: { publicRoot: string; privateRoot: string; prefix: string },
) {
  return createExternalAssets(
    r2ObjectStore(transport, scope, { category: "delivery-photos" }), scope,
  ).photos;
}

let photoCache: { config: R2Config; photos: ReturnType<typeof createR2DeliveryPhotoAssets> } | undefined;
export function getR2DeliveryPhotoAssets() {
  if (getApiDeliveryPhotoStorageProvider() !== "cloudflare-r2") {
    throw new Error("Delivery photo R2 storage is not explicitly selected.");
  }
  const config = r2Config(process.env);
  // Revalidate even on cache hits; never retain a prior bucket/root/credential selection.
  if (!photoCache || Object.keys(config).some(key =>
    config[key as keyof R2Config] !== photoCache!.config[key as keyof R2Config])) {
    photoCache = { config, photos: createR2DeliveryPhotoAssets(r2Transport(config), config) };
  }
  return photoCache.photos;
}

/**
 * Optional injected legacy reader only. Never discovers credentials or selects
 * a legacy backend. Tombstones and missing/corrupt payloads never resurrect data.
 * Legacy mutation fallback is deliberately unsupported.
 */
export async function readR2WithLegacy<T>(primary: () => Promise<T>, legacy?: () => Promise<T>): Promise<T> {
  try { return await primary(); }
  catch (error) {
    if (!legacy || !(error instanceof R2Error) || error.category !== "NOT_FOUND" || !error.legacyEligible) throw error;
    try { return await legacy(); }
    catch { throw new R2Error("UNAVAILABLE"); }
  }
}
