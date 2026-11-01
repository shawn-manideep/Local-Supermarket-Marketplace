import { referenceRoot } from "./object-store.js";
import { exactKeys, plainData } from "../inventory/policy.js";

export const SUPABASE_STORAGE_PROJECT = "nrnigsznectrgbgafwme";
export interface SupabaseStorageConfig {
  readonly projectRef: typeof SUPABASE_STORAGE_PROJECT;
  readonly bucket: string;
  readonly publicRoot: string;
  readonly privateRoot: string;
}

/** Snapshot caller-owned records before constructing an offline connector. */
export function snapshotSupabaseStorageConfig(input: SupabaseStorageConfig): SupabaseStorageConfig {
  try {
    const value = plainData(input);
    exactKeys(value, ["projectRef", "bucket", "publicRoot", "privateRoot"]);
    if (value.projectRef !== SUPABASE_STORAGE_PROJECT ||
        typeof value.bucket !== "string" || typeof value.publicRoot !== "string" ||
        typeof value.privateRoot !== "string") throw new Error();
    return supabaseStorageConfig({
      SUPABASE_URL: `https://${SUPABASE_STORAGE_PROJECT}.supabase.co`,
      SUPABASE_STORAGE_BUCKET: value.bucket,
      SUPABASE_STORAGE_PUBLIC_REFERENCE_ROOT: value.publicRoot,
      SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT: value.privateRoot,
      PUBLIC_OBJECT_SEARCH_PATHS: value.publicRoot,
      PRIVATE_OBJECT_DIR: value.privateRoot,
    });
  } catch { throw new Error("Invalid offline Supabase Storage configuration."); }
}

/** Pure configuration validation. No credentials, SDK, environment loader or I/O. */
export function supabaseStorageConfig(env: Readonly<Record<string, string | undefined>>): SupabaseStorageConfig {
  try {
    if (env.SUPABASE_URL !== `https://${SUPABASE_STORAGE_PROJECT}.supabase.co` ||
        !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.SUPABASE_STORAGE_BUCKET ?? "")) throw new Error();
    const publicRoot = referenceRoot(env.SUPABASE_STORAGE_PUBLIC_REFERENCE_ROOT);
    const privateRoot = referenceRoot(env.SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT);
    if (publicRoot === privateRoot || publicRoot.startsWith(`${privateRoot}/`) ||
        privateRoot.startsWith(`${publicRoot}/`) ||
        referenceRoot(env.PUBLIC_OBJECT_SEARCH_PATHS) !== publicRoot ||
        referenceRoot(env.PRIVATE_OBJECT_DIR) !== privateRoot) throw new Error();
    return Object.freeze({
      projectRef: SUPABASE_STORAGE_PROJECT, bucket: env.SUPABASE_STORAGE_BUCKET!,
      publicRoot, privateRoot,
    });
  } catch {
    throw new Error("Invalid offline Supabase Storage configuration.");
  }
}
