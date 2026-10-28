import { exactKeys, plainData } from "./policy.js";

export type JournalPhase = "INTENT" | "UNKNOWN" | "COMMITTED" | "NOT_COMMITTED" | "CONFLICT";
/** Protected records only; never serialize through the aggregate report channel.
 * Opaque IDs bind to a separate protected manifest, not a URL or object path.
 */
export interface JournalEvent {
  sequence: number;
  operationId: string;
  attempt: number;
  kind: "CREATE" | "REPLACE" | "DELETE";
  phase: JournalPhase;
  expectedGeneration: string | null;
  observedGeneration: string | null;
  evidenceVerified: boolean;
}
/** Specification only. No persistence backend, encryption or credentials installed.
 * appendIfSequence must be atomic across processes and deduplicate identical
 * retries. acknowledge only after durable encrypted commit (including flush).
 * readRun is owner/run-bound and returns bounded pages, never arbitrary queries.
 */
export interface ProtectedJournalPort {
  readRun(request: { cursor?: string; limit: number; signal: AbortSignal }): Promise<{
    events: readonly JournalEvent[]; nextCursor?: string;
  }>;
  appendIfSequence(expectedLastSequence: number, event: JournalEvent, signal: AbortSignal): Promise<{
    outcome: "DURABLE" | "DUPLICATE" | "CONFLICT";
  }>;
  close(): Promise<void>;
}
const fail = (): never => { throw new Error("JOURNAL_RECONCILIATION_REQUIRED"); };
const revision = (value: unknown) => value === null ||
  (typeof value === "string" && /^[1-9]\d{0,39}$/.test(value));
function checked(input: JournalEvent): JournalEvent {
  try {
    const value = plainData(input);
    exactKeys(value, ["sequence", "operationId", "attempt", "kind", "phase",
      "expectedGeneration", "observedGeneration", "evidenceVerified"]);
    if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 ||
        !Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1 ||
        typeof value.operationId !== "string" || !/^[\w-]{1,64}$/.test(value.operationId) ||
        !["CREATE", "REPLACE", "DELETE"].includes(value.kind as string) ||
        !["INTENT", "UNKNOWN", "COMMITTED", "NOT_COMMITTED", "CONFLICT"].includes(value.phase as string) ||
        !revision(value.expectedGeneration) || !revision(value.observedGeneration) ||
        typeof value.evidenceVerified !== "boolean") return fail();
    return Object.freeze({ ...value }) as unknown as JournalEvent;
  } catch { return fail(); }
}
/** Pure bounded replay model. It neither persists nor executes object operations.
 * Evidence flags must eventually come from a separately approved verifier.
 */
export function createJournalReplayModel() {
  const events: JournalEvent[] = [], operations = new Map<string, JournalEvent>();
  return Object.freeze({
    apply(input: JournalEvent): "APPLIED" | "DUPLICATE" {
      const event = checked(input);
      const duplicate = events[event.sequence - 1];
      if (duplicate) {
        if ((Object.keys(event) as (keyof JournalEvent)[]).every(k => duplicate[k] === event[k])) return "DUPLICATE";
        return fail();
      }
      if (events.length >= 10_000 || event.sequence !== events.length + 1) return fail();
      const prior = operations.get(event.operationId);
      if (event.kind === "CREATE" ? event.expectedGeneration !== null : event.expectedGeneration === null) return fail();
      if (prior && (prior.kind !== event.kind || prior.expectedGeneration !== event.expectedGeneration)) return fail();
      if (event.phase === "INTENT") {
        if (event.observedGeneration !== null || event.evidenceVerified ||
            (prior ? prior.phase !== "NOT_COMMITTED" || event.attempt !== prior.attempt + 1 : event.attempt !== 1)) return fail();
      } else {
        if (!prior || !["INTENT", "UNKNOWN"].includes(prior.phase) || event.attempt !== prior.attempt) return fail();
        if (event.phase === "UNKNOWN") {
          if (event.observedGeneration !== null || event.evidenceVerified) return fail();
        } else if (event.phase === "COMMITTED") {
          if (!event.evidenceVerified || (event.kind === "DELETE" ? event.observedGeneration !== null :
              event.observedGeneration === null || event.observedGeneration === event.expectedGeneration)) return fail();
        } else if (event.phase === "NOT_COMMITTED") {
          if (!event.evidenceVerified || event.observedGeneration !== event.expectedGeneration) return fail();
        } else if (event.evidenceVerified) return fail();
      }
      events.push(event);
      operations.set(event.operationId, event);
      return "APPLIED";
    },
    canRetry(operationId: string) { return operations.get(operationId)?.phase === "NOT_COMMITTED"; },
    summary() {
      const counts = { operations: operations.size, events: events.length, pending: 0,
        unknown: 0, committed: 0, notCommitted: 0, conflicts: 0 };
      for (const event of operations.values()) {
        if (event.phase === "INTENT") counts.pending++;
        if (event.phase === "UNKNOWN") counts.unknown++;
        if (event.phase === "COMMITTED") counts.committed++;
        if (event.phase === "NOT_COMMITTED") counts.notCommitted++;
        if (event.phase === "CONFLICT") counts.conflicts++;
      }
      return Object.freeze({ ...counts, recoveryRequired: counts.pending + counts.unknown + counts.conflicts > 0,
        automaticSourceDeletion: false });
    },
  });
}
