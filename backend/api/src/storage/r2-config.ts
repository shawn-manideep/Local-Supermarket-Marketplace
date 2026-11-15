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

/** Temporary endpoint-mismatch diagnostics; never emit either compared string. */
function logEndpointMismatch(env: NodeJS.ProcessEnv, expected: string): void {
  try {
    const actual = env.R2_ENDPOINT;
    let difference: number | null = null;
    if (actual !== undefined) {
      const length = Math.max(actual.length, expected.length);
      for (let index = 0; index < length; index++) {
        if (actual[index] !== expected[index]) { difference = index; break; }
      }
    }
    process.stderr.write(`${JSON.stringify({
      actualEndpointPresent: actual !== undefined,
      expectedEndpointPresent: true,
      actualEndpointLength: actual === undefined ? null : actual.length,
      expectedEndpointLength: expected.length,
      firstDifferencePosition: difference,
      actualCharacterCodeAtDifference: actual !== undefined && difference !== null && difference < actual.length
        ? actual.charCodeAt(difference) : null,
      expectedCharacterCodeAtDifference: difference !== null && difference < expected.length
        ? expected.charCodeAt(difference) : null,
      actualHasLeadingOrTrailingWhitespace: actual === undefined ? null : /^\s|\s$/.test(actual),
      actualHasQuotes: actual === undefined ? null : /["']/.test(actual),
      // The expected endpoint is ASCII; also flag non-ASCII/invisible characters.
      actualHasNonPrintableCharacters: actual === undefined ? null : /[^\x20-\x7e]/.test(actual),
      accountIdPresent: env.R2_ACCOUNT_ID !== undefined,
    })}\n`);
  } catch {
    // Diagnostics must not change the validator's rejection behavior.
  }
}

/** Temporary failure-only diagnostics. Never serialize configuration or errors. */
function logRejectedPredicates(env: NodeJS.ProcessEnv): void {
  try {
    const root = (value: string | undefined) => {
      try { return referenceRoot(value); } catch { return undefined; }
    };
    const privateRoot = root(env.R2_PRIVATE_REFERENCE_ROOT);
    const publicRoot = root(env.R2_PUBLIC_REFERENCE_ROOT);
    const prefix = root(env.R2_OBJECT_PREFIX);
    process.stderr.write(`${JSON.stringify({
      runtimeApprovalValid: env.R2_RUNTIME_APPROVAL === "approved-for-runtime",
      bucketAccessValid: env.R2_BUCKET_ACCESS === "private",
      accountIdValid: /^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID ?? ""),
      accessKeyIdValid: /^[a-fA-F0-9]{32}$/.test(env.R2_ACCESS_KEY_ID ?? ""),
      secretAccessKeyValid: /^[a-fA-F0-9]{64}$/.test(env.R2_SECRET_ACCESS_KEY ?? ""),
      bucketNameValid: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET ?? ""),
      sharedAssetOverrideAbsent: env.API_ASSET_STORAGE_PROVIDER === undefined,
      endpointValid: env.R2_ENDPOINT === `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      privateRootValid: privateRoot !== undefined,
      publicRootValid: publicRoot !== undefined,
      objectPrefixValid: prefix !== undefined,
      rootsDisjoint: privateRoot !== undefined && publicRoot !== undefined &&
        privateRoot !== publicRoot && !privateRoot.startsWith(`${publicRoot}/`) &&
        !publicRoot.startsWith(`${privateRoot}/`),
      privateRootMatches: privateRoot !== undefined && root(env.PRIVATE_OBJECT_DIR) === privateRoot,
      publicRootMatches: publicRoot !== undefined && root(env.PUBLIC_OBJECT_SEARCH_PATHS) === publicRoot,
    })}\n`);
  } catch {
    // Logging must never replace the validator's existing generic error.
  }
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
    if (env.R2_ENDPOINT !== endpoint) {
      logEndpointMismatch(env, endpoint);
      throw new Error();
    }
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
    logRejectedPredicates(env);
    throw new Error("Invalid or unapproved Cloudflare R2 configuration.");
  }
}
