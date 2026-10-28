import { exactKeys, plainArray, plainData } from "./policy.js";

export const API_PARTICIPANTS = Object.freeze(["marketplace-api", "separate-api"] as const);
export const ASSET_WRITERS = Object.freeze([
  "product-upload", "product-compensation", "document-upload-replacement",
  "document-compensation", "branding-replacement", "photo-upload-replacement",
  "photo-prior-cleanup", "photo-compensation", "migration-tools", "background-retries",
] as const);
export interface PauseAcknowledgement {
  api: typeof API_PARTICIPANTS[number];
  instance: string; // Protected opaque instance handle; excluded from output.
  epoch: string;
  writer: typeof ASSET_WRITERS[number];
  paused: boolean;
  inFlight: number;
  queued: number;
  observedAt: number;
}
export interface PauseRoster {
  epoch: string;
  // Must come from an authoritative, separately verified complete deployment roster.
  instances: Readonly<Record<typeof API_PARTICIPANTS[number], readonly string[]>>;
  expiresAt: number;
}
/** Pure gate, NOT a live pause/distributed lease or proof a claimed roster is complete.
 * Both old and new APIs require every workflow acknowledgement, even if inactive.
 */
export function evaluateCutoverGate(rosterInput: PauseRoster, input: readonly PauseAcknowledgement[], now = Date.now()) {
  const blocked = Object.freeze({ status: "BLOCKED" as const, confirmed: 0 });
  try {
    const roster = plainData(rosterInput);
    exactKeys(roster, ["epoch", "instances", "expiresAt"]);
    if (typeof roster.epoch !== "string" || !/^[\w-]{1,64}$/.test(roster.epoch) ||
        !Number.isSafeInteger(now) || !Number.isSafeInteger(roster.expiresAt) ||
        (roster.expiresAt as number) <= now || (roster.expiresAt as number) > now + 60_000 ||
        !Array.isArray(input) || input.length > 2000) return blocked;
    const acknowledgements = plainArray(input, 2000);
    const groups = plainData(roster.instances);
    exactKeys(groups, API_PARTICIPANTS);
    const required = new Set<string>();
    const knownInstances = new Set<string>();
    for (const api of API_PARTICIPANTS) {
      const instances = plainArray(groups[api], 100);
      if (instances.length < 1) return blocked;
      for (const instance of instances) {
        if (typeof instance !== "string" || !/^[\w-]{1,64}$/.test(instance) ||
            knownInstances.has(instance)) return blocked;
        knownInstances.add(instance);
        for (const writer of ASSET_WRITERS) required.add(`${api}:${instance}:${writer}`);
      }
    }
    const confirmed = new Set<string>();
    for (const item of acknowledgements) {
      const ack = plainData(item);
      exactKeys(ack, ["api", "instance", "epoch", "writer", "paused", "inFlight", "queued", "observedAt"]);
      if (typeof ack.api !== "string" || typeof ack.instance !== "string" || typeof ack.writer !== "string" ||
          ack.epoch !== roster.epoch || ack.paused !== true || ack.inFlight !== 0 || ack.queued !== 0 ||
          !Number.isSafeInteger(ack.observedAt) || (ack.observedAt as number) > now ||
          (ack.observedAt as number) < now - 5000) return blocked;
      const key = `${ack.api}:${ack.instance}:${ack.writer}`;
      if (!required.has(key) || confirmed.has(key)) return blocked;
      confirmed.add(key);
    }
    return confirmed.size === required.size
      ? Object.freeze({ status: "SYNTHETIC_GATE_SATISFIED" as const, confirmed: confirmed.size })
      : blocked;
  } catch { return blocked; }
}
