import { externalGcsConfig } from "./external-gcs-config.js";

export const API_OBJECT_STORAGE_PROVIDER_ENV = "API_OBJECT_STORAGE_PROVIDER";

export type ApiObjectStorageProvider = "replit-gcs-sidecar" | "replit-app-storage" | "external-gcs";

export function getApiObjectStorageProvider(
  env: NodeJS.ProcessEnv = process.env,
): ApiObjectStorageProvider {
  const configured = env[API_OBJECT_STORAGE_PROVIDER_ENV];
  if (configured === undefined) return "replit-gcs-sidecar";
  if (configured === "external-gcs") {
    externalGcsConfig(env);
    return configured;
  }
  if (configured === "replit-gcs-sidecar" || configured === "replit-app-storage") {
    return configured;
  }
  throw new Error(
    `${API_OBJECT_STORAGE_PROVIDER_ENV} must be replit-gcs-sidecar, replit-app-storage or external-gcs.`,
  );
}

export function selectApiObjectStorage<T>(
  env: NodeJS.ProcessEnv,
  providers: { replitGcsSidecar: T; replitAppStorage: T; externalGcs?: T },
): T {
  const provider = getApiObjectStorageProvider(env);
  if (provider === "external-gcs") {
    if (providers.externalGcs === undefined) throw new Error("External GCS adapter is not supplied.");
    return providers.externalGcs;
  }
  return provider === "replit-app-storage" ? providers.replitAppStorage : providers.replitGcsSidecar;
}
