import { referenceRoot } from "./object-store.js";

export interface R2Config {
  accountId: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicRoot: string;
  privateRoot: string;
  prefix: string;
}

/** Pure validation. Never reads credentials from disk or discovers an account. */
export function r2Config(env: NodeJS.ProcessEnv): R2Config {
  try {
    if (env.R2_RUNTIME_APPROVAL !== "approved-for-runtime"
      || env.R2_BUCKET_ACCESS !== "private"
      || !/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID ?? "")
      || !/^[a-fA-F0-9]{32}$/.test(env.R2_ACCESS_KEY_ID ?? "")
      || !/^[a-fA-F0-9]{64}$/.test(env.R2_SECRET_ACCESS_KEY ?? "")
      || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET ?? "")
      || env.API_ASSET_STORAGE_PROVIDER !== undefined) throw new Error();
    const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    if (env.R2_ENDPOINT !== endpoint) throw new Error();
    const privateRoot = referenceRoot(env.R2_PRIVATE_REFERENCE_ROOT);
    const publicRoot = referenceRoot(env.R2_PUBLIC_REFERENCE_ROOT);
    const prefix = referenceRoot(env.R2_OBJECT_PREFIX);
    if (privateRoot === publicRoot || privateRoot.startsWith(`${publicRoot}/`)
      || publicRoot.startsWith(`${privateRoot}/`)
      || referenceRoot(env.PRIVATE_OBJECT_DIR) !== privateRoot
      || referenceRoot(env.PUBLIC_OBJECT_SEARCH_PATHS) !== publicRoot) throw new Error();
    return {
      accountId: env.R2_ACCOUNT_ID!, endpoint, bucket: env.R2_BUCKET!,
      accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      publicRoot, privateRoot, prefix,
    };
  } catch {
    throw new Error("Invalid or unapproved Cloudflare R2 configuration.");
  }
}
