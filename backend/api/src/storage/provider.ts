import { externalGcsConfig } from "./external-gcs-config.js";
import { supabaseStorageConfig } from "./supabase-storage-config.js";

export const API_OBJECT_STORAGE_PROVIDER_ENV = "API_OBJECT_STORAGE_PROVIDER";

export type ApiObjectStorageProvider = "replit-gcs-sidecar" | "replit-app-storage" | "external-gcs" | "supabase-storage";

export function getApiObjectStorageProvider(
  env: NodeJS.ProcessEnv = process.env,
): ApiObjectStorageProvider {
  const configured = env[API_OBJECT_STORAGE_PROVIDER_ENV];
  if (configured === undefined) return "replit-gcs-sidecar";
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
    `${API_OBJECT_STORAGE_PROVIDER_ENV} must be replit-gcs-sidecar, replit-app-storage, external-gcs or supabase-storage.`,
  );
}

export function selectApiObjectStorage<T>(
  env: NodeJS.ProcessEnv,
  providers: { replitGcsSidecar: T; replitAppStorage: T; externalGcs?: T; supabaseStorage?: T },
): T {
  const provider = getApiObjectStorageProvider(env);
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
