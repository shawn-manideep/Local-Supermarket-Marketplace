import { referenceRoot } from "./object-store.js";

export interface ExternalGcsConfig {
  projectId: string;
  bucket: string;
  clientEmail: string;
  privateKey: string;
  privateRoot: string;
  publicRoot: string;
}

/** Pure shape checks only. Never contacts Google, reads ADC, or logs values. */
export function externalGcsConfig(env: NodeJS.ProcessEnv): ExternalGcsConfig {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`External GCS configuration requires ${name}.`);
    return value;
  };
  if (env.EXTERNAL_GCS_RUNTIME_APPROVAL !== "approved-for-runtime") {
    throw new Error("External GCS runtime activation requires explicit approval.");
  }
  if (env.STORAGE_EMULATOR_HOST) {
    throw new Error("External GCS does not allow a storage endpoint override.");
  }
  const projectId = required("EXTERNAL_GCS_PROJECT_ID");
  const bucket = required("EXTERNAL_GCS_BUCKET");
  const clientEmail = required("EXTERNAL_GCS_CLIENT_EMAIL");
  const privateKey = required("EXTERNAL_GCS_PRIVATE_KEY");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
      !/^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]$/.test(bucket) ||
      !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(clientEmail) ||
      !/^-----BEGIN PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END PRIVATE KEY-----\r?\n?$/.test(privateKey)) {
    throw new Error("External GCS server configuration is invalid.");
  }
  const privateRoot = referenceRoot(required("EXTERNAL_GCS_PRIVATE_REFERENCE_ROOT"));
  const publicRoot = referenceRoot(required("EXTERNAL_GCS_PUBLIC_REFERENCE_ROOT"));
  if (privateRoot === publicRoot || privateRoot.startsWith(`${publicRoot}/`) ||
      publicRoot.startsWith(`${privateRoot}/`) ||
      referenceRoot(env.PRIVATE_OBJECT_DIR) !== privateRoot ||
      referenceRoot(env.PUBLIC_OBJECT_SEARCH_PATHS) !== publicRoot) {
    throw new Error("External GCS reference mappings must be exact and disjoint.");
  }
  return { projectId, bucket, clientEmail, privateKey, privateRoot, publicRoot };
}
