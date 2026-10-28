import assert from "node:assert/strict";
import test from "node:test";
import { PROJECTIONS, NAMESPACES, type Page, type Row, type ListedObject } from "./contracts.js";
import { syntheticPolicy, validatePolicy } from "./policy.js";
import { createRestrictedReaders, type RestrictedReadPorts } from "./restricted-readers.js";
import { createJournalReplayModel, type JournalEvent, type ProtectedJournalPort } from "./protected-journal.js";
import { API_PARTICIPANTS, ASSET_WRITERS, evaluateCutoverGate,
  type PauseAcknowledgement, type PauseRoster } from "./writer-coordination.js";

const roots = { publicRoot: "fixture-public", privateRoot: "fixture-private" };
const canary = "PRIVATE_FIXTURE_MUST_NOT_REPORT";
const stamp = "2000-01-01T00:00:00Z";
function policy(limits = {}) {
  const p = syntheticPolicy();
  return validatePolicy({ ...p, limits: { ...p.limits, ...limits } });
}
function product(): Row {
  return { id: "fixture-product", store_id: "fixture-store", master_product_id: null,
    image_url: null, is_active: true, updated_at: stamp };
}
function object(): ListedObject {
  return { key: "fixture-public/product-images/fixture-store/fixture-image", generation: "1",
    metageneration: "1", contentType: "image/png", size: 1, created: stamp, updated: stamp };
}
function fixture(overrides: Partial<RestrictedReadPorts> = {}, limits = {}) {
  const calls: unknown[] = [];
  let closed = 0;
  const ports: RestrictedReadPorts = {
    async databasePage(request) { calls.push(request); return { items: [], changed: false }; },
    async metadataPage(request) { calls.push(request); return { items: [], changed: false }; },
    async cancelAndClose() { closed++; },
    ...overrides,
  };
  return { reader: createRestrictedReaders(policy(limits), ports, roots), calls, closed: () => closed };
}

test("restricted ports expose fixed projections and namespaces, no SQL, bytes, writes or bucket selector", async () => {
  const f = fixture();
  for (const table of Object.keys(PROJECTIONS) as (keyof typeof PROJECTIONS)[]) {
    assert.equal((await f.reader.database.page(table)).status, "PAGE");
    const request = f.calls.at(-1) as { columns: string[] };
    assert.deepEqual(request.columns, PROJECTIONS[table]);
    assert.ok(Object.isFrozen(request.columns));
  }
  for (const namespace of NAMESPACES) assert.equal((await f.reader.storage.list(namespace)).status, "PAGE");
  assert.equal(f.reader.summary().status, "TRAVERSAL_COMPLETE");
  assert.deepEqual(Object.keys(f.reader.database), ["page"]);
  assert.deepEqual(Object.keys(f.reader.storage), ["list"]);
  for (const request of f.calls) {
    for (const forbidden of ["query", "sql", "bucket", "url", "credentials", "download", "write"]) {
      assert.equal(forbidden in (request as object), false);
    }
  }
  await f.reader.close();
  assert.equal(f.closed(), 1);
});

test("unknown selectors and post-terminal reuse fail without invoking transports", async () => {
  for (const storage of [false, true]) {
    const f = fixture();
    const result = storage ? await f.reader.storage.list(canary as never) : await f.reader.database.page(canary as never);
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(f.calls.length, 0);
    assert.equal((await f.reader.database.page("products")).status, "INCOMPLETE");
    assert.equal(f.calls.length, 0);
    assert.ok(!JSON.stringify(f.reader.summary()).includes(canary));
    assert.equal(f.closed(), 1);
  }
});

for (const phase of ["database", "storage"] as const) {
  test(`${phase} projection/schema violations and oversized pages close the reader`, async () => {
    for (const mode of ["extra", "oversized", "private-column", "cursor"] as const) {
      const page: Record<string, unknown> = { items: [], changed: false };
      if (mode === "extra") page.privateValue = canary;
      if (mode === "oversized") page.items = [product(), product()];
      if (mode === "private-column") page.items = phase === "database"
        ? [{ ...product(), bank_details: canary }]
        : [{ ...object(), key: `unapproved/${canary}` }];
      if (mode === "cursor") page.nextCursor = "";
      const f = fixture({
        databasePage: async () => page as unknown as Page<Row>,
        metadataPage: async () => page as unknown as Page<ListedObject>,
      }, { pageSize: 1 });
      const result = phase === "database" ? await f.reader.database.page("products")
        : await f.reader.storage.list("product-images");
      assert.equal(result.status, "INCOMPLETE");
      assert.equal(f.closed(), 1);
      assert.ok(!JSON.stringify(result).includes(canary));
    }
  });
}

test("row accessors are rejected without invocation or reflection of private data", async () => {
  let invoked = 0;
  const row = product();
  Object.defineProperty(row, "image_url", { enumerable: true, get() { invoked++; return canary; } });
  const f = fixture({ databasePage: async () => ({ items: [row], changed: false }) });
  assert.equal((await f.reader.database.page("products")).status, "INCOMPLETE");
  assert.equal(invoked, 0);
});

test("page and roster array accessors are rejected before execution", async () => {
  let invoked = 0;
  const items: Row[] = [];
  Object.defineProperty(items, "0", { enumerable: true, get() { invoked++; return product(); } });
  const f = fixture({ databasePage: async () => ({ items, changed: false }) });
  assert.equal((await f.reader.database.page("products")).status, "INCOMPLETE");
  const { now, roster, acks } = pauseFixture();
  Object.defineProperty(acks, "0", { enumerable: true, get() { invoked++; return canary; } });
  assert.equal(evaluateCutoverGate(roster, acks, now).status, "BLOCKED");
  assert.equal(invoked, 0);
});

for (const phase of ["database", "storage"] as const) {
  test(`${phase} repeated cursors and item/request ceilings cannot truncate successfully`, async () => {
    const repeated = { items: [], changed: false, nextCursor: "fixture-cursor" };
    const f = fixture({ databasePage: async () => repeated, metadataPage: async () => repeated });
    const read = () => phase === "database" ? f.reader.database.page("products") : f.reader.storage.list("product-images");
    assert.equal((await read()).status, "PAGE");
    assert.equal((await read()).status, "INCOMPLETE");
    for (const cap of ["items", "requests"] as const) {
      let calls = 0;
      const g = fixture({
        databasePage: async () => { calls++; return { items: [product()], changed: false, nextCursor: "next" }; },
        metadataPage: async () => { calls++; return { items: [object()], changed: false, nextCursor: "next" }; },
      }, phase === "database"
        ? (cap === "items" ? { maxDbRows: 1 } : { maxDbRequests: 1 })
        : (cap === "items" ? { maxObjects: 1 } : { maxStorageRequests: 1 }));
      const next = () => phase === "database" ? g.reader.database.page("products") : g.reader.storage.list("product-images");
      assert.equal((await next()).status, "PAGE");
      assert.equal((await next()).status, "INCOMPLETE");
      assert.equal(calls, 1);
      assert.equal(g.reader.summary().failure, "BUDGET_EXCEEDED");
      assert.equal(g.reader.summary().status, "INCOMPLETE");
    }
  });
}

for (const limits of [{ requestTimeoutMs: 15 }, { maxDbDurationMs: 15 }, { maxDurationMs: 15 }]) {
  test(`cancellation acknowledges mocked transport termination under ${Object.keys(limits)[0]}`, async () => {
    let aborted = false, started = 0;
    const f = fixture({ databasePage: request => {
      started++;
      return new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => { aborted = true; reject(new Error(canary)); }, { once: true });
      });
    } }, limits);
    assert.equal((await f.reader.database.page("products")).status, "INCOMPLETE");
    assert.equal(f.reader.summary().failure, "TIMEOUT");
    assert.equal(aborted, true);
    assert.equal(f.closed(), 1);
    assert.equal(f.reader.summary().cancellationConfirmed, true);
    await f.reader.database.page("products");
    assert.equal(started, 1);
  });
}

test("uncooperative cancellation is bounded, unconfirmed and poisons the session", async () => {
  const f = fixture({ databasePage: () => new Promise(() => {}),
    cancelAndClose: () => new Promise(() => {}) }, { requestTimeoutMs: 5, maxDurationMs: 30 });
  assert.equal((await f.reader.database.page("products")).status, "INCOMPLETE");
  assert.equal(f.reader.summary().cancellationConfirmed, false);
  assert.equal((await f.reader.storage.list("product-images")).status, "INCOMPLETE");
});

test("storage request timeout cancels the active metadata request and closes ports", async () => {
  let aborted = false;
  const f = fixture({ metadataPage: request => new Promise((_, reject) => {
    request.signal.addEventListener("abort", () => { aborted = true; reject(new Error(canary)); }, { once: true });
  }) }, { requestTimeoutMs: 15 });
  assert.equal((await f.reader.storage.list("product-images")).status, "INCOMPLETE");
  assert.equal(f.reader.summary().failure, "TIMEOUT");
  assert.equal(aborted, true);
  assert.equal(f.closed(), 1);
});

test("explicit close aborts active work; concurrent requests cannot bypass ceilings", async () => {
  let signal: AbortSignal | undefined;
  const f = fixture({ databasePage: request => { signal = request.signal; return new Promise(() => {}); } });
  const pending = f.reader.database.page("products");
  await Promise.resolve();
  await f.reader.close();
  assert.equal((await pending).status, "INCOMPLETE");
  assert.equal(signal?.aborted, true);
  assert.equal(f.closed(), 1);
  const g = fixture({ databasePage: () => new Promise(() => {}) });
  const first = g.reader.database.page("products");
  assert.equal((await g.reader.storage.list("product-images")).status, "INCOMPLETE");
  assert.equal((await first).status, "INCOMPLETE");
  assert.equal(g.reader.summary().dbRequests, 1);
  assert.equal(g.reader.summary().storageRequests, 0);
  const h = fixture();
  const notDispatched = h.reader.database.page("products");
  await h.reader.close();
  assert.equal((await notDispatched).status, "INCOMPLETE");
  assert.equal(h.calls.length, 0, "closing before dispatch must not start transport work");
});

function event(patch: Partial<JournalEvent> = {}): JournalEvent {
  return { sequence: 1, operationId: "fixture-operation", attempt: 1, kind: "CREATE", phase: "INTENT",
    expectedGeneration: null, observedGeneration: null, evidenceVerified: false, ...patch };
}
test("journal replay deduplicates identical events and rejects conflicting or unordered operations", () => {
  const model = createJournalReplayModel();
  assert.equal(model.apply(event()), "APPLIED");
  assert.equal(model.apply(event()), "DUPLICATE");
  assert.throws(() => model.apply(event({ kind: "DELETE", expectedGeneration: "1" })), /RECONCILIATION_REQUIRED/);
  assert.throws(() => model.apply(event({ sequence: 3 })), /RECONCILIATION_REQUIRED/);
  assert.throws(() => model.apply(event({ sequence: 2, attempt: 2 })), /RECONCILIATION_REQUIRED/);
  assert.equal(model.summary().events, 1);
});

test("unknown outcomes forbid retries until verified not committed; committed operations never retry", () => {
  const model = createJournalReplayModel();
  model.apply(event());
  model.apply(event({ sequence: 2, phase: "UNKNOWN" }));
  assert.equal(model.canRetry("fixture-operation"), false);
  assert.throws(() => model.apply(event({ sequence: 3, attempt: 2 })));
  model.apply(event({ sequence: 3, phase: "NOT_COMMITTED", evidenceVerified: true }));
  assert.equal(model.canRetry("fixture-operation"), true);
  model.apply(event({ sequence: 4, attempt: 2 }));
  model.apply(event({ sequence: 5, attempt: 2, phase: "COMMITTED", observedGeneration: "9", evidenceVerified: true }));
  assert.equal(model.canRetry("fixture-operation"), false);
  assert.equal(model.summary().recoveryRequired, false);
  assert.equal(model.summary().automaticSourceDeletion, false);
});

for (const kind of ["REPLACE", "DELETE"] as const) {
  test(`journal ${kind} reconciliation validates generation evidence and preserves conflicts`, () => {
    const model = createJournalReplayModel();
    model.apply(event({ kind, expectedGeneration: "8" }));
    assert.throws(() => model.apply(event({ sequence: 2, kind, expectedGeneration: "7",
      phase: "NOT_COMMITTED", observedGeneration: "7", evidenceVerified: true })));
    assert.throws(() => model.apply(event({ sequence: 2, kind, expectedGeneration: "8", phase: "COMMITTED",
      observedGeneration: "8", evidenceVerified: true })));
    model.apply(event({ sequence: 2, kind, expectedGeneration: "8", phase: "CONFLICT", observedGeneration: "10" }));
    assert.equal(model.summary().recoveryRequired, true);
    assert.equal(model.canRetry("fixture-operation"), false);
    const committed = createJournalReplayModel();
    committed.apply(event({ kind, expectedGeneration: "8" }));
    committed.apply(event({ sequence: 2, kind, expectedGeneration: "8", phase: "UNKNOWN" }));
    committed.apply(event({ sequence: 3, kind, expectedGeneration: "8", phase: "COMMITTED",
      observedGeneration: kind === "DELETE" ? null : "11", evidenceVerified: true }));
    assert.equal(committed.summary().committed, 1);
    assert.equal(committed.summary().recoveryRequired, false);
    assert.equal(committed.summary().automaticSourceDeletion, false);
  });
}

test("mock durable port response loss recovers by replay, not blind intent or object retry", async () => {
  const persisted: JournalEvent[] = [];
  let loseResponse = true;
  const port: ProtectedJournalPort = {
    async readRun() { return { events: structuredClone(persisted) }; },
    async appendIfSequence(sequence, value) {
      if (sequence !== persisted.length) return { outcome: "CONFLICT" };
      persisted.push(structuredClone(value));
      if (loseResponse) { loseResponse = false; throw new Error(canary); }
      return { outcome: "DURABLE" };
    },
    async close() {},
  };
  const signal = new AbortController().signal;
  await assert.rejects(port.appendIfSequence(0, event(), signal));
  const recovered = createJournalReplayModel();
  for (const value of (await port.readRun({ limit: 10, signal })).events) recovered.apply(value);
  assert.equal(recovered.summary().pending, 1);
  assert.equal(recovered.canRetry("fixture-operation"), false);
  assert.equal(recovered.apply(event()), "DUPLICATE");
  assert.equal(persisted.length, 1);
  assert.ok(!JSON.stringify(recovered.summary()).includes("fixture-operation"));
  await port.close();
});

function pauseFixture() {
  const now = 10_000;
  const roster: PauseRoster = { epoch: "fixture-epoch", expiresAt: now + 1000,
    instances: { "marketplace-api": ["fixture-old"], "separate-api": ["fixture-new"] } };
  const acks: PauseAcknowledgement[] = API_PARTICIPANTS.flatMap(api =>
    roster.instances[api].flatMap(instance => ASSET_WRITERS.map(writer => ({
      api, instance, writer, epoch: roster.epoch, paused: true, inFlight: 0, queued: 0, observedAt: now,
    }))));
  return { now, roster, acks };
}
test("cutover requires every workflow on both APIs and every rostered instance", () => {
  const { now, roster, acks } = pauseFixture();
  assert.equal(evaluateCutoverGate(roster, acks, now).status, "SYNTHETIC_GATE_SATISFIED");
  for (let i = 0; i < acks.length; i++) {
    assert.equal(evaluateCutoverGate(roster, acks.filter((_, index) => index !== i), now).status, "BLOCKED");
  }
  roster.instances = { ...roster.instances, "marketplace-api": ["fixture-old", "fixture-old-2"] };
  assert.equal(evaluateCutoverGate(roster, acks, now).status, "BLOCKED");
});

test("cutover rejects stale, mismatched, duplicate, unpaused, inflight and queued acknowledgements", () => {
  const { now, roster, acks } = pauseFixture();
  for (const patch of [
    { paused: false }, { inFlight: 1 }, { queued: 1 }, { epoch: canary },
    { instance: canary }, { writer: canary }, { observedAt: now - 5001 }, { observedAt: now + 1 },
  ]) {
    const result = evaluateCutoverGate(roster, [{ ...acks[0]!, ...patch } as PauseAcknowledgement, ...acks.slice(1)], now);
    assert.equal(result.status, "BLOCKED");
    assert.ok(!JSON.stringify(result).includes(canary));
  }
  assert.equal(evaluateCutoverGate(roster, [...acks, acks[0]!], now).status, "BLOCKED");
  assert.equal(evaluateCutoverGate({ ...roster, expiresAt: now }, acks, now).status, "BLOCKED");
});
