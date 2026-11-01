import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseBasicStore, SupabaseStorageError, type SupabaseFailure } from "./supabase-storage.js";
import { createSupabaseObjectStore } from "./supabase-concurrency.js";
import { supabaseStorageConfig } from "./supabase-storage-config.js";
import { getSupabaseAssets } from "./supabase-assets.js";
import { FakeSupabaseStorage, fixtureSupabaseConfig, syntheticSupabaseEnv } from "./fixtures/fake-supabase-storage.js";

const config = fixtureSupabaseConfig(), key = `${config.publicRoot}/product-images/store/image`;
const bytes = Buffer.from("synthetic image");
const metadata = { mimeType: "image/png", cacheControl: "no-store", custom: {} };
const code = (expected: SupabaseFailure) => (error: unknown) =>
  error instanceof SupabaseStorageError && error.code === expected;
function fixture(options?: Parameters<typeof createSupabaseBasicStore>[2]) {
  const client = new FakeSupabaseStorage(config);
  const basic = createSupabaseBasicStore(config, client, options);
  return { client, basic, strict: createSupabaseObjectStore(basic, client.capabilities) };
}

test("fixed isolated project, bucket, exact roots and disjoint namespaces are validated without I/O", () => {
  assert.equal(config.projectRef, "nrnigsznectrgbgafwme");
  for (const patch of [
    { SUPABASE_URL: "https://gkwcolipeavxnuzqlamb.supabase.co" },
    { SUPABASE_URL: `${syntheticSupabaseEnv().SUPABASE_URL}/unexpected` },
    { SUPABASE_STORAGE_BUCKET: "https://wrong.invalid" },
    { SUPABASE_STORAGE_BUCKET: "" },
    { SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT: "legacy-fixture/public" },
    { SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT: "legacy-fixture/public/nested" },
    { PUBLIC_OBJECT_SEARCH_PATHS: "legacy-fixture/public,second" },
    { PRIVATE_OBJECT_DIR: "other/private" },
    { SUPABASE_STORAGE_PUBLIC_REFERENCE_ROOT: "root/../private" },
  ]) assert.throws(() => supabaseStorageConfig({ ...syntheticSupabaseEnv(), ...patch }),
    /^Error: Invalid offline Supabase Storage configuration\.$/);
  assert.ok(Object.isFrozen(config));
});

test("wrong client project/bucket or non-private binding is rejected before operations", () => {
  const f = fixture();
  for (const patch of [{ projectRef: "wrong" }, { bucket: "wrong" }, { privateBucket: false }]) {
    assert.throws(() => createSupabaseBasicStore(config, Object.assign(Object.create(f.client), patch)), code("INVALID_BINDING"));
    assert.throws(() => createSupabaseObjectStore(f.basic, { ...f.client.capabilities, ...patch }), code("INVALID_BINDING"));
  }
  assert.equal(f.client.operations.length, 0);
});

test("caller configuration is validated and snapshotted; getters cannot run during config validation", () => {
  const mutable = { ...config }, client = new FakeSupabaseStorage(config);
  const basic = createSupabaseBasicStore(mutable, client);
  mutable.publicRoot = "other/root";
  assert.equal(basic.config.publicRoot, config.publicRoot);
  assert.ok(Object.isFrozen(basic.config));
  assert.throws(() => createSupabaseBasicStore({ ...config, privateRoot: config.publicRoot }, client),
    /Invalid offline Supabase Storage/);
  let accessed = false;
  const hostile = Object.defineProperty({ ...config }, "bucket", {
    enumerable: true, get() { accessed = true; return config.bucket; },
  });
  assert.throws(() => createSupabaseBasicStore(hostile, client), /Invalid offline Supabase Storage/);
  assert.equal(accessed, false);
});

test("invalid paths, unrelated assets, cross-root nesting and oversized inputs make no port calls", async () => {
  const f = fixture();
  for (const path of ["../file", `${config.publicRoot}/../secret`, `${config.publicRoot}/product-images/a/b/c`,
    `${config.privateRoot}/unapproved/a/b`, "/leading/path", `${config.publicRoot}/product-images/a/%2e%2e`,
    `${config.privateRoot}/delivery-photos/a/../b`, `${config.publicRoot}/vendor-documents/a/b`]) {
    await assert.rejects(f.basic.head(path), code("INVALID_INPUT"));
    await assert.rejects(f.basic.create(path, bytes, "image/png"), code("INVALID_INPUT"));
  }
  await assert.rejects(f.basic.create(key, Buffer.alloc(0), "image/png"), code("INVALID_INPUT"));
  await assert.rejects(f.basic.create(key, Buffer.alloc(5 * 1024 * 1024 + 1), "image/png"), code("INVALID_INPUT"));
  await assert.rejects(f.basic.create(key, bytes, "text/html"), code("INVALID_INPUT"));
  assert.equal(f.client.operations.length, 0);
});

test("basic create is duplicate-safe; download, MIME and metadata stay byte-correct", async () => {
  const f = fixture();
  assert.equal(await f.basic.head(key), null);
  await f.basic.create(key, bytes, "image/png");
  const info = await f.basic.head(key);
  assert.equal(info?.mimeType, "image/png");
  assert.equal(info?.size, bytes.length);
  assert.deepEqual(await f.basic.download(key), { bytes, mimeType: "image/png" });
  await assert.rejects(f.basic.create(key, Buffer.from("replacement"), "image/jpeg"), code("CONFLICT"));
  assert.deepEqual((await f.basic.download(key)).bytes, bytes);
  await f.basic.boundary.close();
  assert.equal(f.client.closes, 1);
});

test("basic clients cannot satisfy pinned reads, replacements or conditional deletion", async () => {
  const f = fixture();
  await f.basic.create(key, bytes, "image/png");
  const strict = createSupabaseObjectStore(f.basic);
  const before = f.client.operations.length;
  await assert.rejects(strict.read(key), code("CAPABILITY_UNAVAILABLE"));
  await assert.rejects(strict.write(key, bytes, metadata, "fixture_1"), code("CAPABILITY_UNAVAILABLE"));
  await assert.rejects(strict.remove(key, "fixture_1"), code("CAPABILITY_UNAVAILABLE"));
  assert.equal(f.client.operations.length, before);
});

test("strict reads remain pinned when a newer revision appears between metadata and read", async () => {
  const f = fixture();
  await f.strict.write(key, bytes, metadata, 0);
  f.client.beforeRead = () => f.client.seed(key, Buffer.from("new body"), "image/jpeg");
  const result = await f.strict.read(key);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.metadata.mimeType, "image/png");
  assert.equal(result.metadata.generation, "fixture_1");
});

test("strict metadata round-trips without passing private cache directives as SDK max-age", async () => {
  const f = fixture();
  const input = { ...metadata, cacheControl: "private, no-store", custom: { visibility: "private", count: 1 },
    contentDisposition: "inline", contentLanguage: "en" };
  await f.strict.write(key, bytes, input, 0);
  const result = await f.strict.read(key);
  assert.deepEqual(result.metadata, { ...input, generation: "fixture_1" });
  await assert.rejects(f.strict.write(key, bytes, { ...input, contentDisposition: "inline\r\nunsafe" }, 0),
    code("INVALID_INPUT"));
  assert.equal(f.client.operations.filter(o => o.operation === "upload").length, 1);
});

test("invalid timeout ceilings and elapsed overall deadlines cannot start work", async () => {
  for (const options of [{ requestTimeoutMs: 0 }, { requestTimeoutMs: 5001 },
    { maxRequests: 0 }, { maxDurationMs: 180001 }]) {
    assert.throws(() => fixture(options), code("INVALID_INPUT"));
  }
  const f = fixture({ requestTimeoutMs: 5, maxDurationMs: 5 });
  await new Promise(resolve => setTimeout(resolve, 12));
  await assert.rejects(f.basic.head(key), code("TIMEOUT"));
  assert.equal(f.client.operations.length, 0);
  assert.equal(f.client.closes, 1);
});

test("replacement and deletion require valid observed revisions and never retry conflicts", async () => {
  const f = fixture();
  await f.strict.write(key, bytes, metadata, 0);
  const revision = (await f.strict.head(key))!.generation;
  await f.strict.write(key, Buffer.from("new"), metadata, revision);
  await assert.rejects(f.strict.write(key, bytes, metadata, revision), code("CONFLICT"));
  await assert.rejects(f.strict.remove(key, revision), code("CONFLICT"));
  assert.equal(f.client.operations.filter(o => o.operation === "replace-revision").length, 2);
  const before = f.client.operations.length;
  await assert.rejects(f.strict.remove(key, ""), code("INVALID_INPUT"));
  assert.equal(f.client.operations.length, before);
  await f.strict.remove(key, (await f.strict.head(key))!.generation);
  assert.equal(await f.strict.head(key), null);
});

test("a misbehaving pinned reader cannot return another generation", async () => {
  const f = fixture();
  f.client.seed(key, bytes, "image/png");
  const strict = createSupabaseObjectStore(f.basic, {
    ...f.client.capabilities,
    readAtRevision: async () => ({ bytes, metadata: { ...metadata, generation: "different" } }),
  });
  await assert.rejects(strict.read(key), code("CONFLICT"));
});

test("metadata without an opaque revision cannot masquerade as ObjectStore metadata", async () => {
  const f = fixture();
  f.client.info = async () => ({ mimeType: "image/png", size: bytes.length }) as never;
  assert.equal((await f.basic.head(key))?.mimeType, "image/png");
  await assert.rejects(f.strict.head(key), code("CAPABILITY_UNAVAILABLE"));
});

test("missing metadata is null and missing downloads are fixed not-found errors", async () => {
  const f = fixture();
  assert.equal(await f.basic.head(key), null);
  await assert.rejects(f.basic.download(key), code("NOT_FOUND"));
  await assert.rejects(f.strict.read(key), code("NOT_FOUND"));
});

test("pre-aborted work makes no attempt; cancellation after upload dispatch is ambiguous", async () => {
  const before = fixture(), cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(before.basic.create(key, bytes, "image/png", cancelled.signal), code("CANCELLED"));
  assert.equal(before.client.operations.length, 0);
  const f = fixture();
  f.client.stall = "upload";
  const controller = new AbortController();
  const work = f.basic.create(key, bytes, "image/png", controller.signal);
  await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(work, code("UNKNOWN_OUTCOME"));
  assert.equal(f.client.lastSignal?.aborted, true);
  assert.equal(f.client.closes, 1);
  assert.equal(f.basic.boundary.state().closed, true);
});

test("timeouts poison the client, bound non-cooperative work and acknowledge cleanup", async () => {
  const f = fixture({ requestTimeoutMs: 10, maxDurationMs: 1000 });
  f.client.stall = "info";
  await assert.rejects(f.basic.head(key), code("TIMEOUT"));
  assert.equal(f.client.lastSignal?.aborted, true);
  assert.equal(f.basic.boundary.state().cancellationConfirmed, true);
  await assert.rejects(f.basic.head(key), code("CLOSED"));
  assert.equal(f.client.operations.length, 1);
});

test("cleanup failures do not replace original failures or claim confirmed cancellation", async () => {
  for (const stallCleanup of [false, true]) {
    const f = fixture({ requestTimeoutMs: 5, maxDurationMs: 1000 });
    f.client.stall = "info";
    f.client.rejectCleanup = true;
    f.client.stallCleanup = stallCleanup;
    await assert.rejects(f.basic.head(key), code("TIMEOUT"));
    assert.equal(f.basic.boundary.state().cancellationConfirmed, false);
    await f.basic.boundary.close();
    assert.equal(f.client.closes, 1);
  }
});

test("single-flight and operation budgets cannot be bypassed", async () => {
  const f = fixture({ maxRequests: 1 });
  f.client.stall = "info";
  const work = f.basic.head(key);
  await assert.rejects(f.basic.head(key), code("BUSY"));
  await f.basic.boundary.close();
  await assert.rejects(work, code("CANCELLED"));
  const limited = fixture({ maxRequests: 1 });
  await limited.basic.head(key);
  await assert.rejects(limited.basic.head(key), code("BUDGET_EXCEEDED"));
  assert.equal(limited.client.operations.length, 1);
});

test("lost upload/replacement/delete responses remain unknown and never retry", async () => {
  for (const operation of ["upload", "replace-revision", "delete-revision"]) {
    const f = fixture();
    if (operation !== "upload") f.client.seed(key, bytes, "image/png");
    f.client.fail = { operation, afterCommit: true, message: "SYNTHETIC_SECRET_DO_NOT_ECHO" };
    const work = operation === "upload" ? f.basic.create(key, bytes, "image/png")
      : operation === "replace-revision" ? f.strict.write(key, bytes, metadata, "fixture_1")
      : f.strict.remove(key, "fixture_1");
    await assert.rejects(work, code("UNKNOWN_OUTCOME"));
    assert.equal(f.client.operations.filter(o => o.operation === operation).length, 1);
    assert.equal(f.client.objects.has(key), operation !== "delete-revision");
    await assert.rejects(f.basic.head(key), code("CLOSED"));
  }
});

test("provider messages, credential canaries and signed URLs never escape errors", async () => {
  const f = fixture();
  f.client.fail = { operation: "info", message: "SYNTHETIC_SECRET https://private.invalid/?token=canary" };
  await assert.rejects(f.basic.head(key), error => {
    assert.equal(String(error), "Error: Supabase storage operation failed (UNAVAILABLE).");
    assert.ok(!JSON.stringify(error).includes("SYNTHETIC_SECRET"));
    assert.ok(!(error as Error).cause);
    return true;
  });
  assert.throws(getSupabaseAssets, code("LIVE_OPERATIONS_DISABLED"));
});

test("tampered fixture errors are re-created rather than forwarded with private details", async () => {
  const f = fixture();
  f.client.info = async () => { throw Object.assign(new SupabaseStorageError("CONFLICT"), {
    message: "SYNTHETIC_PRIVATE_MESSAGE", cause: "SYNTHETIC_PRIVATE_CAUSE",
  }); };
  await assert.rejects(f.basic.head(key), error => {
    assert.equal(String(error), "Error: Supabase storage operation failed (CONFLICT).");
    assert.equal((error as Error).cause, undefined);
    return true;
  });
});

test("typed failures after committed upload, replacement or deletion close the boundary without retry", async () => {
  for (const operation of ["upload", "replace-revision", "delete-revision"]) {
    const f = fixture();
    if (operation !== "upload") f.client.seed(key, bytes, "image/png");
    const fail = () => { throw new SupabaseStorageError("UNAVAILABLE"); };
    if (operation === "upload") {
      const original = f.client.upload.bind(f.client);
      f.client.upload = async (...args) => { await original(...args); fail(); };
    } else if (operation === "replace-revision") {
      const original = f.client.capabilities.replaceIfRevision!;
      f.client.capabilities.replaceIfRevision = async (...args) => { await original(...args); fail(); };
    } else {
      const original = f.client.capabilities.deleteIfRevision!;
      f.client.capabilities.deleteIfRevision = async (...args) => { await original(...args); fail(); };
    }
    const work = operation === "upload" ? f.basic.create(key, bytes, "image/png")
      : operation === "replace-revision" ? f.strict.write(key, Buffer.from("new"), metadata, "fixture_1")
      : f.strict.remove(key, "fixture_1");
    await assert.rejects(work, code("UNKNOWN_OUTCOME"));
    assert.equal(f.client.objects.has(key), operation !== "delete-revision");
    if (operation === "replace-revision") assert.deepEqual(f.client.objects.get(key)!.bytes, Buffer.from("new"));
    assert.equal(f.client.operations.filter(o => o.operation === operation).length, 1);
    assert.equal(f.basic.boundary.state().closed, true);
    assert.equal(f.client.closes, 1);
    await assert.rejects(f.basic.create(key, bytes, "image/png"), code("CLOSED"));
    assert.equal(f.client.operations.filter(o => o.operation === operation).length, 1);
  }
});

test("typed error labels cannot assert a dispatched mutation was safely refused", async () => {
  for (const label of ["INVALID_INPUT", "CONFLICT", "NOT_FOUND", "CLOSED", "UNKNOWN_OUTCOME"] as const) {
    const f = fixture();
    let attempts = 0;
    await assert.rejects(f.basic.boundary.run(true, async () => {
      attempts++;
      throw new SupabaseStorageError(label);
    }), code("UNKNOWN_OUTCOME"));
    assert.equal(attempts, 1);
    assert.equal(f.client.closes, 1);
    assert.equal(f.basic.boundary.state().closed, true);
  }
});

test("typed committed-write failure stays unknown when cleanup also fails", async () => {
  const f = fixture();
  const original = f.client.upload.bind(f.client);
  f.client.upload = async (...args) => {
    await original(...args);
    throw new SupabaseStorageError("UNAVAILABLE");
  };
  f.client.rejectCleanup = true;
  await assert.rejects(f.basic.create(key, bytes, "image/png"), code("UNKNOWN_OUTCOME"));
  assert.equal(f.basic.boundary.state().closed, true);
  assert.equal(f.basic.boundary.state().cancellationConfirmed, false);
  assert.equal(f.client.operations.filter(o => o.operation === "upload").length, 1);
  assert.equal(f.client.closes, 1);
});

test("unknown constructor inputs and mutated error codes use only the fixed safe fallback", async () => {
  const canary = "SYNTHETIC_PRIVATE_CODE_https://fixture.invalid/?token=canary";
  const expected = "Error: Supabase storage operation failed (UNAVAILABLE).";
  for (const value of [canary, "", undefined, null, 404, {}, Symbol("fixture"),
    { toString() { throw new Error("must not coerce"); } }]) {
    const error = new SupabaseStorageError(value as SupabaseFailure);
    assert.equal(error.code, "UNAVAILABLE");
    assert.equal(String(error), expected);
    assert.ok(!error.stack?.includes(canary));
  }
  const f = fixture();
  f.client.info = async () => {
    throw Object.assign(new SupabaseStorageError("CONFLICT"), {
      code: canary, message: canary, cause: canary,
    });
  };
  await assert.rejects(f.basic.head(key), error => {
    assert.ok(code("UNAVAILABLE")(error));
    assert.equal(String(error), expected);
    assert.equal((error as Error).cause, undefined);
    assert.ok(!JSON.stringify(error).includes(canary));
    assert.ok(!(error as Error).stack?.includes(canary));
    return true;
  });
});

test("an accessor replacing an error code is never invoked or forwarded", async () => {
  const f = fixture();
  let accessed = false;
  f.client.info = async () => {
    const error = new SupabaseStorageError("CONFLICT");
    Object.defineProperty(error, "code", { get() { accessed = true; throw new Error("private fixture detail"); } });
    throw error;
  };
  await assert.rejects(f.basic.head(key), code("UNAVAILABLE"));
  assert.equal(accessed, false);
});

test("local validation and pre-dispatch refusal retain safe codes with no mutation attempts", async () => {
  const f = fixture({ maxRequests: 1 }), cancelled = new AbortController();
  await assert.rejects(f.basic.create(key, bytes, "text/html"), code("INVALID_INPUT"));
  cancelled.abort();
  await assert.rejects(f.basic.create(key, bytes, "image/png", cancelled.signal), code("CANCELLED"));
  assert.equal(f.basic.boundary.state().requests, 0);
  assert.equal(f.client.operations.length, 0);
  assert.equal(f.client.closes, 0);
  assert.equal(await f.basic.head(key), null);
  await assert.rejects(f.basic.create(key, bytes, "image/png"), code("BUDGET_EXCEEDED"));
  assert.equal(f.client.operations.filter(o => o.operation === "upload").length, 0);
  await f.basic.boundary.close();
  await assert.rejects(f.basic.create(key, bytes, "image/png"), code("CLOSED"));
  assert.equal(f.client.operations.filter(o => o.operation === "upload").length, 0);
});
