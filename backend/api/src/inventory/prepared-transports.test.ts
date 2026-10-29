import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { syntheticPolicy } from "./policy.js";
import { createOfflineApprovalVerifier, ORIGINAL_INVENTORY_PROJECT } from "./prepared-approval.js";
import { constructPreparedInventory, type PreparedDatabasePort,
  type PreparedMetadataPort, type VerifiedConnectionPlan } from "./prepared-transports.js";

// Ephemeral fixture signing keys only. No real authority/credentials are loaded.
const keys = generateKeyPairSync("ed25519");
const context = Object.freeze({
  operator: "fixture-operator", session: "fixture-session", storageIdentity: "fixture-source",
  databaseRole: "fixture_inventory_reader", publicRoot: "fixture-source/public", privateRoot: "fixture-source/private",
});
const canary = "SYNTHETIC_PRIVATE_MUST_NOT_REPORT";
const id1 = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";
let nonceSequence = 0;
function payload(patch: Record<string, unknown> = {}) {
  const now = Date.now();
  return { version: 1, project: ORIGINAL_INVENTORY_PROJECT, operation: "asset-metadata-inventory",
    ...context, policy: syntheticPolicy(), issuedAt: now, expiresAt: now + 60_000,
    nonce: `fixture-nonce-${String(++nonceSequence).padStart(8, "0")}`, ...patch };
}
function signed(value: unknown, privateKey = keys.privateKey) {
  const text = JSON.stringify(value);
  return [text, sign(null, Buffer.from(text), privateKey).toString("base64url")] as const;
}
function capability(value = payload(), authenticate = () => context) {
  const authority = createOfflineApprovalVerifier(keys.publicKey, authenticate);
  return { authority, capability: authority.verifySigned(...signed(value)) };
}
function row(id = id1) {
  return { id, store_id: id1, master_product_id: null, image_url: null,
    is_active: true, updated_at: "2000-01-01T00:00:00.000Z" };
}
function metadata(name = "public/product-images/fixture-store/fixture-image") {
  return { name, generation: "1", metageneration: "1", size: "10", contentType: "image/png",
    timeCreated: "2000-01-01T00:00:00.000Z", updated: "2000-01-01T00:00:00.000Z" };
}
function ports(dbOverrides: Partial<PreparedDatabasePort> = {}, storageOverrides: Partial<PreparedMetadataPort> = {}) {
  const plans: VerifiedConnectionPlan[] = [], queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const lists: Parameters<PreparedMetadataPort["list"]>[0][] = [];
  let dbClosed = 0, storageClosed = 0;
  const database: PreparedDatabasePort = {
    async connect(plan) { plans.push(plan); },
    async query(request) {
      queries.push(request);
      return { rows: request.text.startsWith("SELECT current_database")
        ? [{ database_name: "postgres", role_name: context.databaseRole, read_only: "on" }] : [] };
    },
    async cancelAndClose() { dbClosed++; }, ...dbOverrides,
  };
  const storage: PreparedMetadataPort = {
    identity: context.storageIdentity,
    async list(request) { lists.push(request); return { items: [] }; },
    async cancelAndClose() { storageClosed++; }, ...storageOverrides,
  };
  return { database, storage, plans, queries, lists, closed: () => [dbClosed, storageClosed] };
}

test("approval rejects invalid signatures, other authorities and tampered payloads", () => {
  const authority = createOfflineApprovalVerifier(keys.publicKey, () => context);
  const [text, signature] = signed(payload());
  assert.throws(() => authority.verifySigned(`${text} `, signature), /APPROVAL_DENIED/);
  const other = generateKeyPairSync("ed25519");
  assert.throws(() => authority.verifySigned(...signed(payload(), other.privateKey)), /APPROVAL_DENIED/);
  assert.throws(() => authority.verifySigned(text, "not-a-signature"), /APPROVAL_DENIED/);
});

test("signed scope cannot expand project, operation, operator, session, roots or policy ceilings", () => {
  for (const patch of [
    { project: "wrong-project" }, { operation: "migration" }, { operator: canary }, { session: canary },
    { storageIdentity: "other-bucket" }, { databaseRole: "postgres" }, { publicRoot: "fixture-source/../private" },
    { privateRoot: context.publicRoot }, { extraCredential: canary },
    { expiresAt: Date.now() - 1 }, { issuedAt: Date.now() + 60_000 },
    { policy: { ...syntheticPolicy(), limits: { ...syntheticPolicy().limits, maxObjects: 10001 } } },
    { policy: { ...syntheticPolicy(), namespaces: ["vendor-documents"] } },
  ]) {
    const authority = createOfflineApprovalVerifier(keys.publicKey, () => context);
    assert.throws(() => authority.verifySigned(...signed(payload(patch))), /APPROVAL_DENIED/);
  }
});

test("approval nonces and opaque capabilities are single-use and cannot be copied", () => {
  const value = payload(), { authority, capability: cap } = capability(value);
  assert.throws(() => authority.verifySigned(...signed(value)), /APPROVAL_DENIED/);
  const reconstructedVerifier = createOfflineApprovalVerifier(keys.publicKey, () => context);
  assert.throws(() => reconstructedVerifier.verifySigned(...signed(value)), /APPROVAL_DENIED/);
  const f = ports();
  assert.throws(() => constructPreparedInventory({ ...cap }, f.database, f.storage), /APPROVAL_DENIED/);
  const reader = constructPreparedInventory(cap, f.database, f.storage);
  assert.throws(() => constructPreparedInventory(cap, f.database, f.storage), /APPROVAL_DENIED/);
  assert.equal(f.plans.length, 0, "construction consumes approval without connecting");
  return reader.close();
});

test("session identity is rechecked at consumption; expired grants cannot construct transports", async () => {
  let authenticated = true;
  const authenticate = () => { if (!authenticated) throw new Error(canary); return context; };
  const { capability: cap } = capability(payload(), authenticate);
  authenticated = false;
  const f = ports();
  assert.throws(() => constructPreparedInventory(cap, f.database, f.storage), /APPROVAL_DENIED/);
  const short = capability(payload({ issuedAt: Date.now(), expiresAt: Date.now() + 30 }));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.throws(() => constructPreparedInventory(short.capability, f.database, f.storage), /APPROVAL_DENIED/);
  assert.equal(f.plans.length, 0);
});

test("database transport uses fixed original identity, verified TLS, read-only settings and projections", async () => {
  const f = ports(), { capability: cap } = capability();
  const reader = constructPreparedInventory(cap, f.database, f.storage);
  assert.equal((await reader.database.page("products")).status, "PAGE");
  assert.equal(f.plans[0]!.project, ORIGINAL_INVENTORY_PROJECT);
  assert.equal(f.plans[0]!.tls.rejectUnauthorized, true);
  assert.equal(f.plans[0]!.host, "aws-0-ap-south-1.pooler.supabase.com");
  assert.equal(f.queries[0]!.text, "BEGIN READ ONLY");
  assert.match(f.queries[1]!.text, /statement_timeout/);
  assert.match(f.queries[1]!.text, /lock_timeout/);
  assert.match(f.queries[1]!.text, /idle_in_transaction_session_timeout/);
  const select = f.queries.at(-1)!;
  assert.match(select.text, /FROM "products".*ORDER BY "id" ASC LIMIT \$2/);
  assert.doesNotMatch(select.text, /password|phone|email|bank|file_name/i);
  assert.deepEqual(select.values, [null, 200]);
  await reader.close();
  assert.deepEqual(f.closed(), [1, 1]);
});

test("database keyset pagination uses bound cursors and rejects unordered/extra/private rows", async () => {
  const p = syntheticPolicy();
  const { capability: cap } = capability(payload({ policy: { ...p, limits: { ...p.limits, pageSize: 1 } } }));
  const f = ports({ async query(request) {
    if (request.text.startsWith("SELECT current_database")) return { rows: [
      { database_name: "postgres", role_name: context.databaseRole, read_only: "on" }] };
    if (request.text.includes('FROM "products"')) return { rows: request.values[0] === null ? [row()] :
      request.values[0] === id1 ? [row(id2)] : [] };
    return { rows: [] };
  } });
  const reader = constructPreparedInventory(cap, f.database, f.storage);
  for (let i = 0; i < 3; i++) assert.equal((await reader.database.page("products")).status, "PAGE");
  await reader.close();
  for (const badRow of [{ ...row(), bank_details: canary }, row("not-a-uuid")]) {
    const g = ports({ async query(request) {
      return { rows: request.text.startsWith("SELECT current_database") ?
        [{ database_name: "postgres", role_name: context.databaseRole, read_only: "on" }] :
        request.text.includes('FROM "products"') ? [badRow] : [] };
    } });
    const bad = constructPreparedInventory(capability().capability, g.database, g.storage);
    assert.equal((await bad.database.page("products")).status, "INCOMPLETE");
    assert.deepEqual(g.closed(), [1, 1]);
  }
});

test("identity/readonly mismatches and preflight budget exhaustion stop before asset queries", async () => {
  for (const identity of [
    { database_name: "other", role_name: context.databaseRole, read_only: "on" },
    { database_name: "postgres", role_name: "postgres", read_only: "on" },
    { database_name: "postgres", role_name: context.databaseRole, read_only: "off" },
  ]) {
    let selects = 0;
    const f = ports({ async query(request) {
      if (request.text.includes('FROM "products"')) selects++;
      return { rows: request.text.startsWith("SELECT current_database") ? [identity] : [] };
    } });
    const reader = constructPreparedInventory(capability().capability, f.database, f.storage);
    assert.equal((await reader.database.page("products")).status, "INCOMPLETE");
    assert.equal(selects, 0);
    assert.deepEqual(f.closed(), [1, 1]);
  }
  const p = syntheticPolicy(), f = ports();
  const reader = constructPreparedInventory(capability(payload({
    policy: { ...p, limits: { ...p.limits, maxDbRequests: 4 } },
  })).capability, f.database, f.storage);
  assert.equal((await reader.database.page("products")).status, "INCOMPLETE");
  assert.equal(reader.summary().failure, "BUDGET_EXCEEDED");
  assert.ok(reader.transportSummary().databaseOperations <= 4);
});

test("metadata transport pins source identity and translates only the explicit legacy source mapping", async () => {
  const f = ports({}, { async list(request) {
    f.lists.push(request);
    return { items: [metadata()] };
  } });
  const reader = constructPreparedInventory(capability().capability, f.database, f.storage);
  const result = await reader.storage.list("product-images");
  assert.equal(result.status, "PAGE");
  if (result.status === "PAGE") assert.equal(result.page.items[0]!.key,
    "fixture-source/public/product-images/fixture-store/fixture-image");
  assert.equal(f.lists[0]!.prefix, "public/product-images/");
  assert.equal("bucket" in f.lists[0]!, false);
  assert.equal(f.plans.length, 0, "storage pages cannot initialize a database connection");
  await reader.close();
  assert.throws(() => constructPreparedInventory(capability().capability, f.database,
    { ...f.storage, identity: "wrong-source" }));
});

test("traversal, cross-namespace, unexpected metadata and permission errors fail closed", async () => {
  for (const bad of [
    metadata("../private/document"), metadata("/public/product-images/a/b"),
    metadata("private/vendor-documents/fixture-store/fixture-doc"),
    { ...metadata(), size: "-1" }, { ...metadata(), secret: canary },
    { ...metadata(), metadata: { bank: canary } },
  ]) {
    const f = ports({}, { async list() { return { items: [bad] }; } });
    const reader = constructPreparedInventory(capability().capability, f.database, f.storage);
    const result = await reader.storage.list("product-images");
    assert.equal(result.status, "INCOMPLETE");
    assert.deepEqual(f.closed(), [1, 1]);
    assert.ok(!JSON.stringify(result).includes(canary));
  }
  const f = ports({}, { async list() { throw Object.assign(new Error(canary), { code: 403 }); } });
  const reader = constructPreparedInventory(capability().capability, f.database, f.storage);
  assert.equal((await reader.storage.list("vendor-documents")).status, "INCOMPLETE");
  assert.ok(!JSON.stringify(reader.summary()).includes(canary));
});

test("metadata pagination is bounded and repeated provider tokens stop traversal", async () => {
  let calls = 0;
  const f = ports({}, { async list() { calls++; return { items: [], nextPageToken: "fixture-token" }; } });
  const reader = constructPreparedInventory(capability().capability, f.database, f.storage);
  assert.equal((await reader.storage.list("delivery-photos")).status, "PAGE");
  assert.equal((await reader.storage.list("delivery-photos")).status, "INCOMPLETE");
  assert.equal(calls, 2);
  assert.equal(reader.summary().status, "INCOMPLETE");
});

for (const phase of ["database", "storage"] as const) {
  test(`prepared ${phase} cancellation reaches mocked transport and closes both ports`, async () => {
    let aborted = false;
    const hang = (signal: AbortSignal) => new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error(canary)); }, { once: true });
    });
    const f = ports(phase === "database" ? { query: request => hang(request.signal) } : {},
      phase === "storage" ? { list: request => hang(request.signal) } : {});
    const p = syntheticPolicy(), reader = constructPreparedInventory(capability(payload({
      policy: { ...p, limits: { ...p.limits, requestTimeoutMs: 20 } },
    })).capability, f.database, f.storage);
    const result = phase === "database" ? await reader.database.page("products") : await reader.storage.list("product-images");
    assert.equal(result.status, "INCOMPLETE");
    assert.equal(aborted, true);
    assert.deepEqual(f.closed(), [1, 1]);
    assert.equal(reader.summary().cancellationConfirmed, true);
  });
}

test("cleanup failure is unconfirmed, redacted and cannot reactivate readers", async () => {
  let otherClosed = false;
  const f = ports({ async cancelAndClose() { throw new Error(canary); } },
    { async cancelAndClose() { otherClosed = true; } });
  const reader = constructPreparedInventory(capability().capability, f.database, f.storage);
  await reader.close();
  assert.equal(otherClosed, true);
  assert.equal(reader.summary().cancellationConfirmed, false);
  assert.equal((await reader.database.page("products")).status, "INCOMPLETE");
  assert.equal(f.plans.length, 0);
});

test("call path has no configuration loader or alternate live CLI activation", async () => {
  for (const file of ["prepared-approval.ts", "prepared-transports.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /process\.env|fetch\s*\(|from\s+["'](?:pg|@google|@supabase|@workspace\/db)/);
    assert.doesNotMatch(source, /console\.(?:log|error|warn)|getSignedUrl|\.download\(/);
  }
  for (const file of ["entry.ts", "cli.ts", "runner.ts", "synthetic.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /prepared-approval|prepared-transports/);
  }
});
