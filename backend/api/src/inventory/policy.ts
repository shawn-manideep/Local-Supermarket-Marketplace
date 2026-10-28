import { createHash } from "node:crypto";
import { types } from "node:util";
import { InventoryFailure, LIMIT_CAPS, NAMESPACES, type Policy } from "./contracts.js";

/** Reject executable properties and unexpected data instead of reflecting it. */
export function plainData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new InventoryFailure("INVALID_POLICY");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string") ||
      Object.values(descriptors).some(d => d.get || d.set || !d.enumerable)) {
    throw new InventoryFailure("INVALID_POLICY");
  }
  return value as Record<string, unknown>;
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) {
    throw new InventoryFailure("INVALID_POLICY");
  }
}
export function validatePolicy(input: unknown): Policy {
  const value = plainData(input);
  exactKeys(value, ["version", "target", "history", "namespaces", "limits"]);
  if (value.version !== 1 || value.target !== "original-apna-local-basket" ||
      value.history !== "current-objects-and-retained-document-rows") {
    throw new InventoryFailure("INVALID_POLICY");
  }
  const ns = value.namespaces;
  if (!Array.isArray(ns) || ns.length !== NAMESPACES.length ||
      NAMESPACES.some((name, i) => Object.getOwnPropertyDescriptor(ns, String(i))?.value !== name) ||
      Object.keys(ns).length !== NAMESPACES.length) {
    throw new InventoryFailure("INVALID_POLICY");
  }
  const limits = plainData(value.limits);
  exactKeys(limits, Object.keys(LIMIT_CAPS));
  const checked = {} as Record<keyof typeof LIMIT_CAPS, number>;
  for (const key of Object.keys(LIMIT_CAPS) as (keyof typeof LIMIT_CAPS)[]) {
    const number = limits[key];
    if (typeof number !== "number" || !Number.isSafeInteger(number) ||
        number < 1 || number > LIMIT_CAPS[key]) throw new InventoryFailure("INVALID_POLICY");
    checked[key] = number;
  }
  return Object.freeze({
    version: 1, target: "original-apna-local-basket",
    history: "current-objects-and-retained-document-rows",
    namespaces: Object.freeze([...NAMESPACES]), limits: Object.freeze(checked),
  });
}
/** Used internally for authorization binding; never included in reports. */
export function policyDigest(policy: Policy): string {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}
export function syntheticPolicy(): Policy {
  return validatePolicy({
    version: 1, target: "original-apna-local-basket",
    history: "current-objects-and-retained-document-rows",
    namespaces: [...NAMESPACES], limits: { ...LIMIT_CAPS },
  });
}
