import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "./cli.js";
import { LIMIT_CAPS, NAMESPACES, PROJECTIONS, type ListedObject, type Policy } from "./contracts.js";
import { syntheticPolicy, validatePolicy } from "./policy.js";
import { finishReport, newReport, serializeReport } from "./report.js";
import { runMetadataInventory, validatePolicyOnly } from "./runner.js";
import {
  createSyntheticSession, emptySyntheticDataset, resolveSyntheticAuthorization,
  type SyntheticDataset,
} from "./synthetic.js";

const stamp = "2000-01-01T00:00:00.000Z";
const canary = "SYNTHETIC_CANARY_DO_NOT_REPORT";
function object(key: string, mime = "image/png"): ListedObject {
  return { key, generation: "1", metageneration: "1", size: 10, contentType: mime,
    created: stamp, updated: stamp, crc32c: canary, md5Hash: canary,
    contentDisposition: `inline; filename="${canary}"`, cacheControl: "no-store" };
}
function dataset(): SyntheticDataset {
  const data = emptySyntheticDataset();
  data.tables.products = [
    { id: "fixture-product", store_id: "fixture-store", master_product_id: "fixture-master",
      image_url: null, is_active: false, updated_at: stamp },
    { id: "fixture-empty", store_id: "fixture-store", master_product_id: "fixture-master",
      image_url: "", is_active: true, updated_at: stamp },
  ];
  data.tables.master_products = [{ id: "fixture-master",
    image: "/api/product-images/fixture-store/fixture-image", is_active: false, updated_at: stamp }];
  data.tables.stores = [{ id: "fixture-store", logo_image_url: null, updated_at: stamp }];
  data.tables.vendor_documents = [
    { id: "fixture-document-old", store_id: "fixture-store", document_type: "pan",
      object_ref: "/fixture-private/vendor-documents/fixture-store/fixture-document-old",
      mime_type: "application/pdf", size_bytes: 10, version: 1, is_current: false,
      uploaded_at: stamp, updated_at: stamp },
    { id: "fixture-document", store_id: "fixture-store", document_type: "pan",
      object_ref: "/fixture-private/vendor-documents/fixture-store/fixture-document",
      mime_type: "application/pdf", size_bytes: 10, version: 2, is_current: true,
      uploaded_at: stamp, updated_at: stamp },
  ];
  data.tables.delivery_pickup_photos = [{ id: "fixture-photo", assignment_id: "fixture-assignment",
    object_ref: "/fixture-private/delivery-photos/fixture-assignment/fixture-photo",
    mime_type: "image/png", size_bytes: 10, captured_at: stamp, uploaded_at: stamp }];
  data.objects["product-images"] = [
    object("fixture-public/product-images/fixture-store/fixture-image"),
    object("fixture-public/product-images/fixture-store/fixture-unreferenced"),
  ];
  data.objects["application-branding"] = [object("fixture-public/application-branding/active-logo")];
  data.objects["vendor-documents"] = data.tables.vendor_documents.map(row => ({
    ...object(String(row.object_ref).slice(1), "application/pdf"),
    cacheControl: "private, no-store", visibility: "private",
  }));
  data.objects["delivery-photos"] = [{
    ...object("fixture-private/delivery-photos/fixture-assignment/fixture-photo"),
    cacheControl: "private, no-store", visibility: "private",
  }];
  return data;
}
function policy(limits: Partial<Policy["limits"]> = {}) {
  const base = syntheticPolicy();
  return validatePolicy({ ...base, limits: { ...base.limits, ...limits } });
}
async function scan(data = dataset(), p = policy()) {
  const fixture = createSyntheticSession(p, data);
  const result = await runMetadataInventory(p, fixture.session, fixture.authorization);
  return { result, fixture };
}
async function* input(value: unknown) { yield JSON.stringify(value); }

test("offline policy validation initializes no readers, network, environment or credential access", () => {
  const fixture = createSyntheticSession(policy(), dataset());
  const result = validatePolicyOnly(policy());
  assert.equal(result.status, "validated-offline");
  assert.deepEqual(fixture.stats(), { databasePages: 0, storagePages: 0 });
  let credentialReads = 0;
  const hostile = { ...policy() };
  Object.defineProperty(hostile, "target", { enumerable: true, get() {
    credentialReads++; throw new Error(canary);
  } });
  assert.equal(validatePolicyOnly(hostile).failure, "INVALID_POLICY");
  assert.equal(credentialReads, 0);
});

test("targets, namespaces, policy extensions and excessive budgets are rejected without echo", () => {
  for (const candidate of [
    { ...policy(), target: canary },
    { ...policy(), namespaces: [...NAMESPACES, canary] },
    { ...policy(), namespaces: [...NAMESPACES].reverse() },
    { ...policy(), credentials: canary },
    { ...policy(), limits: { ...policy().limits, maxObjects: 10_001 } },
    { ...policy(), limits: { ...policy().limits, maxDbRows: 0 } },
  ]) {
    const result = validatePolicyOnly(candidate);
    assert.equal(result.complete, false);
    assert.equal(result.failure, "INVALID_POLICY");
    assert.ok(!serializeReport(result).includes(canary));
  }
});

test("metadata execution requires a policy-bound, expiring, single-use synthetic grant", async () => {
  const p = policy();
  const f = createSyntheticSession(p, dataset());
  assert.equal((await runMetadataInventory(p)).failure, "EXECUTION_NOT_AUTHORIZED");
  assert.equal((await runMetadataInventory(p, f.session, {})).failure, "EXECUTION_NOT_AUTHORIZED");
  assert.equal((await runMetadataInventory(policy({ maxObjects: 20 }), f.session, f.authorization)).failure,
    "EXECUTION_NOT_AUTHORIZED");
  assert.deepEqual(f.stats(), { databasePages: 0, storagePages: 0 });
  assert.equal((await runMetadataInventory(p, f.session, f.authorization)).complete, true);
  assert.equal((await runMetadataInventory(p, f.session, f.authorization)).failure, "EXECUTION_NOT_AUTHORIZED");
  const expired = createSyntheticSession(p, dataset(), 1);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await runMetadataInventory(p, expired.session, expired.authorization)).failure,
    "EXECUTION_NOT_AUTHORIZED");
  assert.deepEqual(expired.stats(), { databasePages: 0, storagePages: 0 });
});

test("capabilities expose only fixed projections and metadata pages, never byte or administrative operations", () => {
  const p = policy(), f = createSyntheticSession(p, dataset());
  const capabilities = resolveSyntheticAuthorization(p, f.session, f.authorization);
  assert.deepEqual(Object.keys(capabilities.database), ["page"]);
  assert.deepEqual(Object.keys(capabilities.storage), ["list"]);
  for (const forbidden of ["download", "read", "get", "save", "write", "delete", "copy",
    "getSignedUrl", "getIamPolicy", "setIamPolicy", "query", "execute", "client", "credentials"]) {
    assert.equal(forbidden in capabilities.database, false);
    assert.equal(forbidden in capabilities.storage, false);
  }
  assert.ok(Object.isFrozen(capabilities));
  assert.ok(Object.isFrozen(capabilities.storage));
  for (const columns of Object.values(PROJECTIONS)) {
    assert.ok(Object.isFrozen(columns));
    assert.equal(columns.some(column => /phone|address|email|file_name|password/.test(column)), false);
  }
});

test("all four namespaces, inactive and historical rows, separate assets and null-only fallback reconcile", async () => {
  const data = dataset(), before = JSON.stringify(data);
  const { result } = await scan(data, policy({ pageSize: 1 }));
  assert.equal(result.complete, true);
  assert.equal(result.source, "synthetic-in-memory");
  assert.equal(result.consistency, "non-atomic");
  assert.equal(result.classes["product-images"].matched, 1);
  assert.equal(result.classes["product-images"].empty, 1);
  assert.equal(result.classes["master-images"].matched, 1);
  assert.equal(result.classes["store-logos"].empty, 1);
  assert.equal(result.classes["application-branding"].matched, 1);
  assert.equal(result.classes["vendor-documents"].matched, 2);
  assert.equal(result.classes["delivery-photos"].matched, 1);
  assert.equal(result.unreferencedCandidates, 1);
  assert.equal(result.mappingCollisions, 0);
  assert.equal(JSON.stringify(data), before, "the caller's synthetic dataset is unchanged");
});

for (const [label, limits] of [
  ["database rows", { maxDbRows: 1 }],
  ["object rows", { maxObjects: 1 }],
  ["database requests", { maxDbRequests: 1 }],
  ["storage requests", { maxStorageRequests: 1 }],
] as const) test(`exhausted ${label} budget is incomplete, never success`, async () => {
  const { result } = await scan(dataset(), policy(limits));
  assert.equal(result.complete, false);
  assert.equal(result.failure, "BUDGET_EXCEEDED");
});

for (const phase of ["database", "storage"] as const) test(`${phase} permission and SDK errors are redacted`, async () => {
  for (const fault of ["permission", "sdk-error"] as const) {
    const { result } = await scan({ ...dataset(), faultAt: phase, fault });
    assert.equal(result.complete, false);
    assert.equal(result.failure, fault === "permission" ? "PERMISSION_DENIED" : "READER_FAILED");
    const output = serializeReport(result);
    for (const secret of [canary, "fixture-store", "fixture-private", "fixture.invalid", "fixture-document"]) {
      assert.ok(!output.includes(secret));
    }
  }
});

test("timeouts cancel stalled readers and repeated cursors cannot loop indefinitely", async () => {
  const { result } = await scan({ ...dataset(), fault: "stall" }, policy({ requestTimeoutMs: 5 }));
  assert.equal(result.complete, false);
  assert.equal(result.failure, "TIMEOUT");
  assert.equal((await scan({ ...dataset(), fault: "repeated-cursor" })).result.failure, "INVALID_SOURCE_METADATA");
});

test("concurrent generations and source changes require reconciliation, never completed verification", async () => {
  const data = dataset();
  data.changed = true;
  data.objects["product-images"].push({ ...data.objects["product-images"][0]!, generation: "2" });
  const { result } = await scan(data);
  assert.equal(result.complete, false);
  assert.equal(result.failure, "RECONCILIATION_REQUIRED");
  assert.equal(result.consistency, "non-atomic");
  assert.ok(result.concurrentChanges > 0);
});

test("mapping collisions, missing objects and MIME/size/private-metadata mismatches are counted", async () => {
  const data = dataset();
  data.objects["product-images"].push({
    ...data.objects["product-images"][0]!, key: `/${data.objects["product-images"][0]!.key}`,
  });
  data.objects["delivery-photos"] = [];
  data.objects["vendor-documents"][0] = {
    ...data.objects["vendor-documents"][0]!, contentType: "image/png", size: 11, cacheControl: "public",
  };
  const { result } = await scan(data);
  assert.equal(result.complete, false);
  assert.equal(result.failure, "RECONCILIATION_REQUIRED");
  assert.equal(result.mappingCollisions, 1);
  assert.equal(result.classes["delivery-photos"].missingCandidates, 1);
  assert.equal(result.classes["vendor-documents"].metadataMismatches, 1);
});

test("unapproved object namespaces and extra database columns abort safely", async () => {
  const data = dataset();
  data.objects["product-images"][0] = {
    ...data.objects["product-images"][0]!, key: `fixture-private/vendor-documents/${canary}`,
  };
  assert.equal((await scan(data)).result.failure, "INVALID_SOURCE_METADATA");
  const other = dataset();
  other.tables.stores[0] = { ...other.tables.stores[0]!, phone: canary };
  assert.equal((await scan(other)).result.failure, "INVALID_SOURCE_METADATA");
});

test("unsupported references are not followed, and aggregate reports are immutable and redact metadata", async () => {
  const data = dataset();
  data.tables.products[0] = { ...data.tables.products[0]!, image_url: `javascript:${canary}` };
  const { result } = await scan(data);
  assert.equal(result.complete, false);
  assert.equal(result.failure, "RECONCILIATION_REQUIRED");
  assert.equal(result.classes["product-images"].unsupported, 1);
  assert.ok(!serializeReport(result).includes(canary));
  assert.ok(Object.isFrozen(result.classes["product-images"]));
  assert.ok(!serializeReport({ failure: canary } as never).includes(canary));
});

test("external references are counted without fetching and block completed reconciliation", async () => {
  const data = dataset();
  data.tables.stores[0] = { ...data.tables.stores[0]!, logo_image_url: `https://fixture.invalid/${canary}` };
  const { result } = await scan(data);
  assert.equal(result.status, "incomplete");
  assert.equal(result.failure, "RECONCILIATION_REQUIRED");
  assert.equal(result.classes["store-logos"].external, 1);
  assert.ok(!serializeReport(result).includes(canary));
});

test("unexpected page schema and oversized pages fail closed in both phases", async () => {
  for (const faultAt of ["database", "storage"] as const) {
    for (const fault of ["extra-page-field", "oversized-page"] as const) {
      const { result } = await scan({ ...dataset(), fault, faultAt });
      assert.equal(result.status, "incomplete");
      assert.equal(result.failure, "INVALID_SOURCE_METADATA");
      assert.ok(!serializeReport(result).includes("SYNTHETIC-PRIVATE"));
    }
  }
});

test("each missing, mismatched or colliding object independently blocks completion", async () => {
  for (const anomaly of ["missing", "mismatched", "collision"] as const) {
    const data = dataset();
    if (anomaly === "missing") data.objects["delivery-photos"] = [];
    if (anomaly === "mismatched") data.objects["vendor-documents"][0] = {
      ...data.objects["vendor-documents"][0]!, cacheControl: "public",
    };
    if (anomaly === "collision") data.objects["product-images"].push({
      ...data.objects["product-images"][0]!, key: `/${data.objects["product-images"][0]!.key}`,
    });
    const { result } = await scan(data);
    assert.equal(result.status, "incomplete");
    assert.equal(result.failure, "RECONCILIATION_REQUIRED");
  }
});

test("request, database and overall deadlines reject delayed synchronous results", async () => {
  for (const limits of [
    { requestTimeoutMs: 1 }, { maxDbDurationMs: 1 }, { maxDurationMs: 1 },
  ]) {
    const { result, fixture } = await scan({ ...dataset(), fault: "synchronous-delay" }, policy(limits));
    assert.equal(result.failure, "TIMEOUT");
    assert.equal(result.status, "incomplete");
    assert.equal(fixture.stats().databasePages, 1);
  }
  const lateStorage = await scan({ ...dataset(), fault: "synchronous-delay", faultAt: "storage" },
    policy({ requestTimeoutMs: 1 }));
  assert.equal(lateStorage.result.failure, "TIMEOUT");
  assert.equal(lateStorage.fixture.stats().storagePages, 1);
});

test("report registration cannot label unresolved reference anomalies complete", () => {
  for (const field of ["unsupported", "external", "missingCandidates", "metadataMismatches"] as const) {
    const value = structuredClone(newReport("metadata-only"));
    value.classes["product-images"][field] = 1;
    rejectedReport({ ...value, complete: true, status: "synthetic-complete",
      source: "synthetic-in-memory", consistency: "non-atomic" });
  }
  for (const field of ["mappingCollisions", "concurrentChanges"]) {
    rejectedReport({ ...newReport("metadata-only"), [field]: 1, complete: true,
      status: "synthetic-complete", source: "synthetic-in-memory", consistency: "non-atomic" });
  }
});

function rejectedReport(candidate: unknown) {
  assert.throws(() => finishReport(candidate), {
    name: "Error", message: "INVALID_SOURCE_METADATA",
  });
  const output = serializeReport(candidate as never);
  assert.equal(JSON.parse(output).failure, "INVALID_SOURCE_METADATA");
  assert.ok(!output.includes(canary));
}

test("importing callers cannot register arbitrary strings in any report field", () => {
  for (const key of Object.keys(newReport("metadata-only"))) {
    const candidate = { ...newReport("metadata-only"), [key]: canary };
    rejectedReport(candidate);
    assert.equal(Object.isFrozen(candidate), false, "invalid input was not frozen or registered");
  }
});

test("report schema rejects extra, missing, symbolic and hidden fields at every level", () => {
  for (const level of ["report", "classes", "counts"] as const) {
    for (const mutation of ["extra", "missing", "symbol", "hidden", "toJSON"] as const) {
      const candidate = structuredClone(newReport("metadata-only"));
      const target = level === "report" ? candidate
        : level === "classes" ? candidate.classes : candidate.classes["product-images"];
      const key = Object.keys(target)[0]!;
      if (mutation === "extra") Object.assign(target, { unexpected: canary });
      if (mutation === "missing") Reflect.deleteProperty(target, key);
      if (mutation === "symbol") Object.defineProperty(target, Symbol(canary), { value: canary });
      if (mutation === "hidden") Object.defineProperty(target, key, { value: canary, enumerable: false });
      if (mutation === "toJSON") Object.defineProperty(target, "toJSON", {
        value: () => canary, enumerable: false,
      });
      rejectedReport(candidate);
    }
  }
});

test("malformed report nesting, arrays, objects, accessors and proxies fail without execution", () => {
  for (const value of [null, undefined, [], [canary], canary, new Date(0), new Map(),
    Object.create({ inherited: canary })]) {
    rejectedReport(value);
    rejectedReport({ ...newReport("metadata-only"), classes: value });
    rejectedReport({ ...newReport("metadata-only"), classes: {
      ...newReport("metadata-only").classes, "product-images": value,
    } });
  }
  let executed = 0;
  for (const level of ["report", "classes", "counts"] as const) {
    const candidate = structuredClone(newReport("metadata-only"));
    const target = level === "report" ? candidate
      : level === "classes" ? candidate.classes : candidate.classes["product-images"];
    Object.defineProperty(target, Object.keys(target)[0]!, { enumerable: true,
      get() { executed++; throw new Error(canary); } });
    rejectedReport(candidate);
  }
  rejectedReport(new Proxy(newReport("metadata-only"), {
    getPrototypeOf() { executed++; throw new Error(canary); },
  }));
  assert.equal(executed, 0);
});

test("aggregate counts reject coercions and unsafe values and accept exact inclusive bounds", () => {
  const caps = {
    dbRows: LIMIT_CAPS.maxDbRows, objects: LIMIT_CAPS.maxObjects,
    dbRequests: LIMIT_CAPS.maxDbRequests, storageRequests: LIMIT_CAPS.maxStorageRequests,
    concurrentChanges: LIMIT_CAPS.maxDbRows + 2 * LIMIT_CAPS.maxObjects
      + LIMIT_CAPS.maxDbRequests + LIMIT_CAPS.maxStorageRequests,
    mappingCollisions: LIMIT_CAPS.maxObjects, unreferencedCandidates: LIMIT_CAPS.maxObjects,
  };
  const badValues = [-1, -0, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
    "0", canary, null, undefined, true, {}, [], 0n];
  for (const [key, cap] of Object.entries(caps)) {
    for (const value of [...badValues, cap + 1]) {
      rejectedReport({ ...newReport("metadata-only"), [key]: value });
    }
    for (const value of [0, cap]) {
      const report = finishReport({ ...newReport("metadata-only"), [key]: value });
      assert.equal(JSON.parse(serializeReport(report))[key], value);
    }
  }
  for (const asset of Object.keys(newReport("metadata-only").classes)) {
    for (const key of Object.keys(newReport("metadata-only").classes["product-images"])) {
      const cap = LIMIT_CAPS.maxDbRows + 1;
      for (const value of [...badValues, cap + 1, 0, cap]) {
        const candidate = structuredClone(newReport("metadata-only"));
        Object.assign(candidate.classes[asset as keyof typeof candidate.classes], { [key]: value });
        if (value === 0 && !Object.is(value, -0) || value === cap) {
          assert.equal(JSON.parse(serializeReport(finishReport(candidate))).classes[asset][key], value);
        } else rejectedReport(candidate);
      }
    }
  }
});

test("report enums and completion semantics are strict while incomplete warnings remain valid", () => {
  for (const patch of [
    { complete: "false" }, { complete: 0 }, { mode: {} }, { status: [] },
    { failure: {} }, { failure: false }, { source: {} }, { consistency: null },
    { complete: true }, { status: "synthetic-complete" },
    { complete: true, status: "validated-offline" },
    { complete: true, status: "synthetic-complete", source: "synthetic-in-memory",
      consistency: "non-atomic", failure: "TIMEOUT" },
  ]) rejectedReport({ ...newReport("metadata-only"), ...patch });
  for (const failure of [null, "INVALID_POLICY", "EXECUTION_NOT_AUTHORIZED",
    "LIVE_EXECUTION_UNAVAILABLE", "BUDGET_EXCEEDED", "TIMEOUT", "PERMISSION_DENIED",
    "INVALID_SOURCE_METADATA", "READER_FAILED"]) {
    const report = finishReport({ ...newReport("metadata-only"), failure,
      source: "synthetic-in-memory", consistency: "non-atomic", concurrentChanges: 2 });
    const output = JSON.parse(serializeReport(report));
    assert.equal(output.complete, false);
    assert.equal(output.failure, failure);
    assert.equal(output.concurrentChanges, 2);
  }
});

test("registration snapshots valid data and serialization refuses unregistered lookalikes", () => {
  const input = structuredClone(newReport("metadata-only"));
  const registered = finishReport(input);
  assert.notEqual(registered, input);
  assert.notEqual(registered.classes, input.classes);
  Object.assign(input, { failure: canary });
  Object.assign(input.classes["product-images"], { references: canary });
  assert.equal(JSON.parse(serializeReport(registered)).failure, null);
  assert.ok(!serializeReport(registered).includes(canary));
  rejectedReport(input);
  assert.equal(JSON.parse(serializeReport(structuredClone(registered))).failure, "INVALID_SOURCE_METADATA");
  assert.ok(Object.isFrozen(registered.classes["product-images"]));
  assert.throws(() => Object.assign(registered, { failure: canary }), TypeError);
});

test("CLI validation is offline; metadata cannot be unlocked by stdin or extra flags", async () => {
  assert.equal((await main(["--mode=validate-policy-only"], input(policy()))).complete, true);
  assert.equal((await main(["--mode=metadata-only"], input(policy()))).failure, "LIVE_EXECUTION_UNAVAILABLE");
  assert.equal((await main(["--mode=metadata-only", "--approved"], input(policy()))).complete, false);
  assert.equal((await main(["--mode=validate-policy-only"], input({ ...policy(), authorization: canary }))).failure,
    "INVALID_POLICY");
  assert.equal((await main(["--mode=validate-policy-only"], input(canary.repeat(2000)))).failure, "INVALID_POLICY");
  async function* broken() { throw new Error(canary); }
  const result = await main(["--mode=validate-policy-only"], broken());
  assert.ok(!serializeReport(result).includes(canary));
});

test("real CLI process emits aggregate JSON only and refuses metadata despite synthetic environment markers", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const guard = fileURLToPath(new URL("../../scripts/inventory-no-io-guard.mjs", import.meta.url));
  for (const mode of ["validate-policy-only", "metadata-only"]) {
    const result = spawnSync(process.execPath, [
      "--import", guard, "--import", "tsx", "src/inventory/entry.ts", `--mode=${mode}`,
    ], {
      cwd: root, input: JSON.stringify(policy()), encoding: "utf8", timeout: 5000,
      env: { API_OBJECT_STORAGE_PROVIDER: "external-gcs", EXTERNAL_GCS_RUNTIME_APPROVAL: canary,
        EXTERNAL_GCS_PRIVATE_KEY: canary },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, mode === "metadata-only" ? 1 : 0);
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes(canary));
    assert.equal(JSON.parse(result.stdout).complete, mode !== "metadata-only");
  }
});

test("CLI input duration is bounded even if the input never finishes", async () => {
  async function* stalled() { await new Promise(() => undefined); yield ""; }
  assert.equal((await main(["--mode=validate-policy-only"], stalled())).complete, false);
});

test("guard blocks even local network and conventional credential-file reads", async () => {
  assert.throws(() => fetch("http://127.0.0.1/"), /I\/O denied/);
  await assert.rejects(async () => readFile("/fixture/.config/gcloud/application_default_credentials.json"),
    /I\/O denied/);
});

test("inventory source imports no application bootstrap, provider, SDK, SQL, environment or logger", async () => {
  const files = (await readdir(new URL("./", import.meta.url))).filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"));
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'](?:@google|@supabase|@workspace\/db|pg|drizzle|.*\/storage\/|.*\/app\.|.*\/auth\/)/);
    assert.doesNotMatch(source, /process\.env|console\.(?:log|error|warn)|\bfetch\s*\(/);
  }
});
