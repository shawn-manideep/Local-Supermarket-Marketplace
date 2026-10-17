export const API_OBJECT_STORAGE_PROVIDER_ENV = "API_OBJECT_STORAGE_PROVIDER";

export type ApiObjectStorageProvider = "replit-gcs-sidecar" | "replit-app-storage";

export function getApiObjectStorageProvider(
  env: NodeJS.ProcessEnv = process.env,
): ApiObjectStorageProvider {
  const configured = env[API_OBJECT_STORAGE_PROVIDER_ENV];
  if (configured === undefined) return "replit-gcs-sidecar";
  if (configured === "replit-gcs-sidecar" || configured === "replit-app-storage") {
    return configured;
  }
  throw new Error(
    `${API_OBJECT_STORAGE_PROVIDER_ENV} must be replit-gcs-sidecar or replit-app-storage.`,
  );
}

export function selectApiObjectStorage<T>(
  env: NodeJS.ProcessEnv,
  providers: { replitGcsSidecar: T; replitAppStorage: T },
): T {
  return getApiObjectStorageProvider(env) === "replit-app-storage"
    ? providers.replitAppStorage
    : providers.replitGcsSidecar;
}
