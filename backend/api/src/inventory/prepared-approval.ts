import { createHash, verify, type KeyObject } from "node:crypto";
import { exactKeys, plainData, validatePolicy } from "./policy.js";
import { canonicalKey } from "./reconcile.js";
import type { Policy } from "./contracts.js";

export const ORIGINAL_INVENTORY_PROJECT = "gkwcolipeavxnuzqlamb";
export interface PreparedBinding {
  operator: string;
  session: string;
  storageIdentity: string;
  databaseRole: string;
  publicRoot: string;
  privateRoot: string;
  policy: Policy;
  expiresAt: number;
}
interface TrustedContext extends Omit<PreparedBinding, "policy" | "expiresAt"> {}
const grants = new WeakMap<object, { binding: PreparedBinding; assertCurrent: () => void }>();
// Shared across verifier instances for the same pinned key within this process.
// A production multi-process deployment still needs a durable atomic nonce store.
const ledgers = new Map<string, Map<string, number>>();
const denied = (): never => { throw new Error("INVENTORY_APPROVAL_DENIED"); };

/** Preparation only: caller-supplied TEST public key and mocked authenticated
 * context. No default authority, key loader, environment or real login provider.
 * Production must pin authority and obtain context from a trusted auth boundary.
 */
export function createOfflineApprovalVerifier(publicKey: KeyObject, authenticatedContext: () => TrustedContext) {
  if (publicKey.type !== "public" || publicKey.asymmetricKeyType !== "ed25519") return denied();
  const authorityId = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  if (!ledgers.has(authorityId)) {
    if (ledgers.size >= 16) return denied();
    ledgers.set(authorityId, new Map());
  }
  const seen = ledgers.get(authorityId)!;
  return Object.freeze({
    verifySigned(payload: string, signature: string): object {
      try {
        if (typeof payload !== "string" || Buffer.byteLength(payload) > 16_384 ||
            typeof signature !== "string" || !/^[\w-]{86}$/.test(signature) ||
            !verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64url"))) return denied();
        const value = plainData(JSON.parse(payload));
        exactKeys(value, ["version", "project", "operation", "operator", "session",
          "storageIdentity", "databaseRole", "publicRoot", "privateRoot", "policy", "issuedAt", "expiresAt", "nonce"]);
        const context = plainData(authenticatedContext());
        exactKeys(context, ["operator", "session", "storageIdentity", "databaseRole", "publicRoot", "privateRoot"]);
        for (const field of Object.keys(context)) {
          if (typeof context[field] !== "string" || context[field] !== value[field]) return denied();
        }
        if (!/^[\w-]{1,64}$/.test(value.operator as string) ||
            !/^[\w-]{1,64}$/.test(value.session as string) ||
            !/^[a-z0-9][a-z0-9._-]{2,62}$/.test(value.storageIdentity as string) ||
            !/^[a-z_][a-z0-9_]{2,62}$/.test(value.databaseRole as string) ||
            /^(postgres|service_role|anon|authenticated|supabase_.*)$/.test(value.databaseRole as string)) return denied();
        const roots = [value.publicRoot, value.privateRoot] as string[];
        if (roots.some(root => canonicalKey(root) !== root ||
            !root.startsWith(`${value.storageIdentity}/`)) || roots[0] === roots[1] ||
            roots[0]!.startsWith(`${roots[1]}/`) || roots[1]!.startsWith(`${roots[0]}/`)) return denied();
        const now = Date.now(), policy = validatePolicy(value.policy);
        if (value.version !== 1 || value.project !== ORIGINAL_INVENTORY_PROJECT ||
            value.operation !== "asset-metadata-inventory" || !Number.isSafeInteger(value.issuedAt) ||
            !Number.isSafeInteger(value.expiresAt) || (value.issuedAt as number) > now ||
            (value.expiresAt as number) <= now || (value.expiresAt as number) <= (value.issuedAt as number) ||
            (value.expiresAt as number) - (value.issuedAt as number) > policy.limits.maxDurationMs ||
            typeof value.nonce !== "string" || !/^[\w-]{16,64}$/.test(value.nonce)) return denied();
        for (const [nonce, expiry] of seen) if (expiry <= now) seen.delete(nonce);
        if (seen.has(value.nonce) || seen.size >= 4096) return denied();
        seen.set(value.nonce, value.expiresAt as number);
        const capability = Object.freeze({});
        const binding = Object.freeze({ ...context, policy, expiresAt: value.expiresAt }) as unknown as PreparedBinding;
        grants.set(capability, { binding, assertCurrent() {
          try {
            const current = plainData(authenticatedContext());
            exactKeys(current, Object.keys(context));
            if (Object.keys(context).some(key => current[key] !== context[key])) return denied();
          } catch { return denied(); }
        } });
        return capability;
      } catch { return denied(); }
    },
  });
}

/** Single-use, in-memory consumption. Not a live execution-approval store. */
export function consumePreparedApproval(capability: object): PreparedBinding {
  const grant = grants.get(capability);
  if (!grant || grant.binding.expiresAt <= Date.now()) return denied();
  grants.delete(capability);
  grant.assertCurrent();
  return grant.binding;
}
