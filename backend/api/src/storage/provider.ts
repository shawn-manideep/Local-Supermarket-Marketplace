import { externalGcsConfig } from "./external-gcs-config.js";
import { supabaseStorageConfig } from "./supabase-storage-config.js";
import { r2Config } from "./r2-config.js";
import { assertApiOnlyTarget } from "../api-only/target-guard.js";

export const API_OBJECT_STORAGE_PROVIDER_ENV = "API_OBJECT_STORAGE_PROVIDER";
export const STORAGE_UNAVAILABLE_MESSAGE = "Storage is unavailable.";

export type ApiObjectStorageProvider = "replit-gcs-sidecar" | "replit-app-storage" | "external-gcs" | "supabase-storage" | "cloudflare-r2" | "disabled";

export function getApiObjectStorageProvider(
  env: NodeJS.ProcessEnv = process.env,
): ApiObjectStorageProvider {
  const configured = env[API_OBJECT_STORAGE_PROVIDER_ENV];
  if (configured === undefined) return "replit-gcs-sidecar";
  if (configured === "cloudflare-r2") {
    r2Config(env);
    return configured;
  }
  if (configured === "disabled") {
    if (env.API_ONLY_TARGET_PROFILE !== "isolated-native-preview") {
      throw new Error("Disabled storage requires the isolated-native-preview target profile.");
    }
    return configured;
  }
  if (configured === "supabase-storage") {
    supabaseStorageConfig(env);
    return configured;
  }
  if (configured === "external-gcs") {
    externalGcsConfig(env);
    return configured;
  }
  if (configured === "replit-gcs-sidecar" || configured === "replit-app-storage") {
    return configured;
  }
  throw new Error(
    `${API_OBJECT_STORAGE_PROVIDER_ENV} must be replit-gcs-sidecar, replit-app-storage, external-gcs, supabase-storage, cloudflare-r2 or disabled.`,
  );
}

export function assertStorageOperationsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (getApiObjectStorageProvider(env) === "disabled") {
    throw new Error(STORAGE_UNAVAILABLE_MESSAGE);
  }
}

export function selectApiObjectStorage<T>(
  env: NodeJS.ProcessEnv,
  providers: { replitGcsSidecar: T; replitAppStorage: T; externalGcs?: T; supabaseStorage?: T; cloudflareR2?: T },
): T {
  const provider = getApiObjectStorageProvider(env);
  if (provider === "disabled") throw new Error(STORAGE_UNAVAILABLE_MESSAGE);
  if (provider === "cloudflare-r2") {
    if (providers.cloudflareR2 === undefined) throw new Error("Cloudflare R2 adapter is not supplied.");
    return providers.cloudflareR2;
  }
  if (provider === "supabase-storage") {
    if (providers.supabaseStorage === undefined) throw new Error("Offline Supabase Storage adapter is not supplied.");
    return providers.supabaseStorage;
  }
  if (provider === "external-gcs") {
    if (providers.externalGcs === undefined) throw new Error("External GCS adapter is not supplied.");
    return providers.externalGcs;
  }
  return provider === "replit-app-storage" ? providers.replitAppStorage : providers.replitGcsSidecar;
}

export const API_ASSET_STORAGE_PROVIDER_ENV = "API_ASSET_STORAGE_PROVIDER";

export type ApiAssetStorageProvider = "supabase-storage";

export function getApiAssetStorageProvider(
  env: NodeJS.ProcessEnv = process.env,
): ApiAssetStorageProvider | undefined {
  const configured = env[API_ASSET_STORAGE_PROVIDER_ENV];

  if (configured === undefined) return undefined;

  if (configured === "supabase-storage") {
    supabaseStorageConfig(env);
    return configured;
  }

  throw new Error(
    `${API_ASSET_STORAGE_PROVIDER_ENV} must be supabase-storage when configured.`,
  );
}

export const API_VENDOR_DOCUMENT_STORAGE_PROVIDER_ENV = "API_VENDOR_DOCUMENT_STORAGE_PROVIDER";

/** Pure, fail-closed opt-in. This does not relax the global disabled guard. */
export function getApiVendorDocumentStorageProvider(
  env: NodeJS.ProcessEnv = process.env,
): "supabase-storage" | undefined {
  const configured = env[API_VENDOR_DOCUMENT_STORAGE_PROVIDER_ENV];
  if (configured === undefined) return undefined;
  if (configured !== "supabase-storage") {
    throw new Error(`${API_VENDOR_DOCUMENT_STORAGE_PROVIDER_ENV} must be supabase-storage when configured.`);
  }
  if (env.API_ASSET_STORAGE_PROVIDER !== undefined ||
      env.API_OBJECT_STORAGE_PROVIDER === "cloudflare-r2") {
    throw new Error("Vendor document storage conflicts with shared asset or R2 selection.");
  }
  // Full existing project/key/database/TLS/signing validation, not just the
  // provider parser's narrower disabled/profile check. No connection is made.
  assertApiOnlyTarget(env);
  supabaseStorageConfig(env);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Vendor document storage requires a server-side service credential.");
  }
  return configured;
}
