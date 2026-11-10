import { createExternalAssets } from "./external-assets.js";
import { r2Config } from "./r2-config.js";
import { R2Error, r2ObjectStore, type R2Transport } from "./r2-store.js";
import { r2Transport } from "./r2-transport.js";

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
