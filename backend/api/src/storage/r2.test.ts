import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { getApiObjectStorageProvider, selectApiObjectStorage } from "./provider.js";
import { r2Config } from "./r2-config.js";
import { createR2Assets, readR2WithLegacy } from "./r2-assets.js";
import { R2Error, r2ObjectStore, type R2Request, type R2Transport } from "./r2-store.js";
import { r2Transport } from "./r2-transport.js";
import type { ObjectWriteMetadata } from "./object-store.js";

const scope = { publicRoot: "legacy/public", privateRoot: "legacy/private", prefix: "alb-r2" };
const env = () => ({
  API_OBJECT_STORAGE_PROVIDER: "cloudflare-r2",
  R2_RUNTIME_APPROVAL: "approved-for-runtime", R2_BUCKET_ACCESS: "private",
  R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "b".repeat(32), R2_SECRET_ACCESS_KEY: "c".repeat(64),
  R2_BUCKET: "synthetic-bucket", R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  R2_PRIVATE_REFERENCE_ROOT: scope.privateRoot, R2_PUBLIC_REFERENCE_ROOT: scope.publicRoot,
  PRIVATE_OBJECT_DIR: scope.privateRoot, PUBLIC_OBJECT_SEARCH_PATHS: scope.publicRoot,
  R2_OBJECT_PREFIX: scope.prefix,
});
const key = `${scope.publicRoot}/product-images/store/image`;
const meta: ObjectWriteMetadata = { mimeType: "image/jpeg", cacheControl: "no-store",
  custom: { visibility: "published-product", count: 1, reviewed: false, note: null },
  contentDisposition: "inline", contentLanguage: "en" };
const jpeg = (value = 0) => Buffer.from([255, 216, 255, ...Array(20).fill(value), 255, 217]);
const failure = (category: string) => (error: unknown) => error instanceof R2Error && error.category === category;

class FakeR2 {
  objects = new Map<string, { body: Buffer; etag: string; metadata?: ObjectWriteMetadata }>();
  calls: R2Request[] = [];
  before?: (request: R2Request) => Promise<void>;
  after?: (request: R2Request) => void;
  transport: R2Transport = async request => {
    this.calls.push(request);
    await this.before?.(request);
    if (request.signal.aborted) throw new R2Error("CANCELLED");
    const old = this.objects.get(request.key);
    if (request.kind === "get") {
      if (!old) throw new R2Error("NOT_FOUND");
      const result = { body: Buffer.from(old.body), etag: old.etag };
      this.after?.(request);
      return result;
    }
    if (request.ifNoneMatch === "*" && old || request.ifMatch && request.ifMatch !== old?.etag) {
      throw new R2Error("CONFLICT");
    }
    assert.ok(request.ifMatch || request.ifNoneMatch, "every write must be conditional");
    const body = Buffer.from(request.body!);
    this.objects.set(request.key, {
      body, etag: `"${createHash("sha256").update(body).digest("hex")}"`,
      metadata: structuredClone(request.metadata),
    });
    this.after?.(request);
    return {};
  };
  store(options: Parameters<typeof r2ObjectStore>[2] = {}) { return r2ObjectStore(this.transport, scope, options); }
}

test("R2 configuration requires explicit endpoint, bucket, credentials, roots and runtime approval", () => {
  const valid = env();
  assert.equal(r2Config(valid).bucket, "synthetic-bucket");
  for (const name of Object.keys(valid)) {
    const invalid: NodeJS.ProcessEnv = { ...valid }; delete invalid[name];
    // Provider selection is enforced separately, not by this pure config parser.
    if (name === "API_OBJECT_STORAGE_PROVIDER") continue;
    assert.throws(() => r2Config(invalid), /^Error: Invalid or unapproved Cloudflare R2 configuration\.$/);
  }
  for (const invalid of [
    { R2_ENDPOINT: "http://127.0.0.1" }, { R2_BUCKET: "../other" },
    { R2_PUBLIC_REFERENCE_ROOT: "legacy/private" }, { R2_OBJECT_PREFIX: "../escape" },
    { R2_RUNTIME_APPROVAL: "true" }, { R2_BUCKET_ACCESS: "public" },
    { API_ASSET_STORAGE_PROVIDER: "supabase-storage" }, { R2_SECRET_ACCESS_KEY: "sensitive-invalid" },
  ]) assert.throws(() => r2Config({ ...valid, ...invalid }), /Invalid or unapproved/);
});

test("R2 selection is opt-in and never changes existing default or disabled storage", () => {
  assert.equal(getApiObjectStorageProvider({}), "replit-gcs-sidecar");
  assert.equal(getApiObjectStorageProvider(env()), "cloudflare-r2");
  assert.equal(getApiObjectStorageProvider({ API_OBJECT_STORAGE_PROVIDER: "disabled", API_ONLY_TARGET_PROFILE: "isolated-native-preview" }), "disabled");
  assert.throws(() => getApiObjectStorageProvider({ API_OBJECT_STORAGE_PROVIDER: "cloudflare-r2" }), /unapproved/);
  assert.throws(() => selectApiObjectStorage(env(), { replitGcsSidecar: 1, replitAppStorage: 2 }), /not supplied/);
  assert.equal(selectApiObjectStorage(env(), { replitGcsSidecar: 1, replitAppStorage: 2, cloudflareR2: 3 }), 3);
});

test("R2 create-only upload, exact download and metadata preservation", async () => {
  const fake = new FakeR2(), store = fake.store();
  await store.write(key, jpeg(), meta, 0);
  const result = await store.read(key);
  assert.deepEqual(result.bytes, jpeg());
  assert.deepEqual({ ...result.metadata, generation: undefined }, { ...meta, generation: undefined });
  assert.match(result.metadata.generation, /^[0-9a-f-]{36}$/);
  assert.notEqual(result.metadata.generation, [...fake.objects.values()][0]!.etag);
  const payload = [...fake.objects.values()].find(row => row.body.equals(jpeg()));
  assert.deepEqual(payload?.metadata, meta);
  await assert.rejects(store.write(key, jpeg(1), meta, 0), failure("CONFLICT"));
  assert.deepEqual((await store.read(key)).bytes, jpeg());
});

test("R2 concurrent creates have exactly one winner", async () => {
  const fake = new FakeR2(), store = fake.store();
  const results = await Promise.allSettled([store.write(key, jpeg(1), meta, 0), store.write(key, jpeg(2), meta, 0)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected" && failure("CONFLICT")(r.reason)).length, 1);
});

test("R2 conditional replacement rejects stale revisions including identical-byte ABA", async () => {
  const fake = new FakeR2(), store = fake.store();
  await store.write(key, jpeg(), meta, 0);
  const first = (await store.head(key))!;
  await store.write(key, jpeg(1), meta, first.generation);
  const second = (await store.head(key))!;
  await store.write(key, jpeg(), meta, second.generation);
  assert.notEqual((await store.head(key))!.generation, first.generation);
  await assert.rejects(store.write(key, jpeg(2), meta, first.generation), failure("CONFLICT"));
  await assert.rejects(store.remove(key, first.generation), failure("CONFLICT"));
});

test("R2 concurrent replacements and deletes cannot remove a winning newer revision", async () => {
  const fake = new FakeR2(), store = fake.store();
  await store.write(key, jpeg(), meta, 0);
  const revision = (await store.head(key))!.generation;
  const results = await Promise.allSettled([store.write(key, jpeg(2), meta, revision), store.remove(key, revision)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected" && failure("CONFLICT")(r.reason)).length, 1);
  const head = await store.head(key);
  if (head) assert.deepEqual((await store.read(key)).bytes, jpeg(2));
  else await assert.rejects(store.read(key), failure("NOT_FOUND"));
});

test("R2 logical deletion preserves payloads, forbids key reuse and prevents legacy resurrection", async () => {
  const fake = new FakeR2(), store = fake.store();
  await store.write(key, jpeg(), meta, 0);
  await store.remove(key, (await store.head(key))!.generation);
  assert.equal(await store.head(key), null);
  await assert.rejects(store.write(key, jpeg(1), meta, 0), failure("CONFLICT"));
  let legacy = 0;
  await assert.rejects(readR2WithLegacy(() => store.read(key), async () => { legacy++; return {} as never; }), failure("NOT_FOUND"));
  assert.equal(legacy, 0);
  assert.equal(fake.objects.size, 2);
  assert.ok(fake.calls.every(call => ["put", "get"].includes(call.kind)));
});

test("R2 read returns the immutable revision selected before a concurrent replacement", async () => {
  const fake = new FakeR2(), store = fake.store();
  await store.write(key, jpeg(), meta, 0);
  const first = (await store.head(key))!;
  fake.before = async request => {
    if (request.kind === "get" && request.key.includes("/objects/")) {
      fake.before = undefined;
      await store.write(key, jpeg(3), meta, first.generation);
    }
  };
  assert.deepEqual((await store.read(key)).bytes, jpeg());
  assert.deepEqual((await store.read(key)).bytes, jpeg(3));
});

test("R2 integrity checks reject tampered payloads and do not fall back on missing payload", async () => {
  const fake = new FakeR2(), store = fake.store();
  await store.write(key, jpeg(), meta, 0);
  const payloadKey = [...fake.objects.keys()].find(k => k.includes("/objects/"))!;
  fake.objects.get(payloadKey)!.body = jpeg(5);
  await assert.rejects(store.read(key), failure("INTEGRITY"));
  fake.objects.delete(payloadKey);
  await assert.rejects(readR2WithLegacy(() => store.read(key), async () => { throw new Error("must not run"); }), failure("INTEGRITY"));
});

test("R2 paths and MIME/content/size enforce all four namespace boundaries before I/O", async () => {
  const fake = new FakeR2(), store = fake.store();
  for (const path of ["../escape", "other/public/product-images/s/i", `${scope.privateRoot}/product-images/s/i`,
    `${scope.publicRoot}/vendor-documents/s/i`, `${key}/extra`, `${scope.publicRoot}/application-branding/other`]) {
    await assert.rejects(store.write(path, jpeg(), meta, 0), failure("INVALID_INPUT"));
  }
  await assert.rejects(store.write(key, Buffer.from("not an image"), meta, 0), failure("INVALID_INPUT"));
  await assert.rejects(store.write(key, Buffer.alloc(5 * 1024 * 1024 + 1), meta, 0), failure("INVALID_INPUT"));
  await assert.rejects(store.write(key, jpeg(), { ...meta, mimeType: "text/html" }, 0), failure("INVALID_INPUT"));
  await assert.rejects(store.write(`${scope.privateRoot}/vendor-documents/s/i`, jpeg(), meta, 0), failure("INVALID_INPUT"));
  assert.equal(fake.calls.length, 0);
});

test("R2 private documents/photos and public branding use existing asset interfaces", async () => {
  const fake = new FakeR2(), assets = createR2Assets(fake.transport, scope);
  const document = `${scope.privateRoot}/vendor-documents/store/doc`;
  const photo = `${scope.privateRoot}/delivery-photos/order/photo`;
  const pdf = Buffer.from("%PDF-1.7\nsynthetic document\n%%EOF");
  await assets.documents.put(document, pdf, "application/pdf");
  await assets.photos.put(photo, jpeg(), "image/jpeg");
  await assets.products.put("store", "image", jpeg(), "image/jpeg");
  await assets.branding.put(jpeg(), "image/jpeg");
  assert.deepEqual(await assets.documents.get(document), pdf);
  assert.deepEqual(await assets.photos.get(photo), jpeg());
  assert.deepEqual((await assets.products.get("store", "image")).bytes, jpeg());
  assert.equal((await assets.branding.metadata())?.mimeType, "image/jpeg");
  await assets.branding.put(jpeg(3), "image/jpeg");
  assert.deepEqual((await assets.branding.get()).bytes, jpeg(3));
  await assert.rejects(assets.photos.get(document), /allowed namespace/);
  const privatePayload = [...fake.objects.values()].find(o => o.body.equals(pdf))!;
  assert.equal(privatePayload.metadata?.cacheControl, "private, no-store");
  await assets.photos.discard(photo);
  await assert.rejects(assets.photos.get(photo), failure("NOT_FOUND"));
});

test("R2 legacy reads fall back only on confirmed never-owned NOT_FOUND", async () => {
  let legacyCalls = 0;
  const legacy = async () => { legacyCalls++; return 7; };
  const fake = new FakeR2(), store = fake.store();
  assert.equal(await readR2WithLegacy(() => store.read(key).then(() => 1), legacy), 7);
  assert.equal(legacyCalls, 1);
  for (const category of ["UNAVAILABLE", "INTEGRITY", "CONFLICT", "TIMEOUT", "UNKNOWN_OUTCOME", "CANCELLED"] as const) {
    await assert.rejects(readR2WithLegacy(async () => { throw new R2Error(category); }, legacy), failure(category));
  }
  await assert.rejects(readR2WithLegacy(async () => { throw new Error("provider failure"); }, legacy));
  assert.equal(legacyCalls, 1);
});

test("R2 pre-mutation timeout and cancellation stop without writes or retries", async () => {
  const fake = new FakeR2();
  fake.before = async () => new Promise(() => {});
  await assert.rejects(fake.store({ timeoutMs: 10 }).write(key, jpeg(), meta, 0), failure("TIMEOUT"));
  assert.equal(fake.calls.length, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fake.store({ signal: controller.signal }).read(key), failure("CANCELLED"));
  assert.equal(fake.calls.length, 1);
});

test("R2 in-flight cancellation aborts the transport and removes listeners", async () => {
  const fake = new FakeR2(), controller = new AbortController();
  fake.before = async request => {
    controller.abort();
    assert.equal(request.signal.aborted, true);
  };
  await assert.rejects(fake.store({ signal: controller.signal }).read(key), failure("CANCELLED"));
  assert.equal(fake.calls.length, 1);
});

test("R2 unknown outcomes retain payloads and never retry after manifest commit response loss", async () => {
  const fake = new FakeR2(), store = fake.store();
  fake.after = request => {
    if (request.kind === "put" && request.key.includes("/references/")) throw new Error("sensitive SDK response");
  };
  await assert.rejects(store.write(key, jpeg(), meta, 0), error => {
    assert.ok(error instanceof R2Error);
    assert.equal(error.message.includes("sensitive"), false);
    return error.category === "UNKNOWN_OUTCOME";
  });
  assert.equal(fake.calls.filter(c => c.kind === "put").length, 2);
  fake.after = undefined;
  assert.deepEqual((await store.read(key)).bytes, jpeg());
});

test("R2 in-flight mutation timeout is UNKNOWN_OUTCOME and cannot publish after abort", async () => {
  const fake = new FakeR2();
  let release!: () => void;
  fake.before = async request => {
    if (request.kind === "put") await new Promise<void>(resolve => { release = resolve; });
  };
  await assert.rejects(fake.store({ timeoutMs: 10 }).write(key, jpeg(), meta, 0), failure("UNKNOWN_OUTCOME"));
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fake.calls.filter(c => c.kind === "put").length, 1);
  assert.equal(fake.objects.size, 0);
});

test("R2 delete response loss reports unknown outcome without physical deletion or retries", async () => {
  const fake = new FakeR2(), store = fake.store();
  await store.write(key, jpeg(), meta, 0);
  const revision = (await store.head(key))!.generation;
  const before = fake.calls.length;
  fake.after = request => {
    if (request.kind === "put") throw new Error("lost delete acknowledgement");
  };
  await assert.rejects(store.remove(key, revision), failure("UNKNOWN_OUTCOME"));
  assert.equal(fake.calls.length - before, 2);
  assert.equal(fake.objects.size, 2);
  fake.after = undefined;
  assert.equal(await store.head(key), null);
});

test("R2 corrupt manifests and stale conditional publication fail closed", async () => {
  const fake = new FakeR2(), store = fake.store();
  await store.write(key, jpeg(), meta, 0);
  const manifest = [...fake.objects.entries()].find(([k]) => k.includes("/references/"))![1];
  manifest.body = Buffer.from('{"secret":"provider-detail"}');
  await assert.rejects(store.read(key), failure("INTEGRITY"));
  await assert.rejects(store.write(key, jpeg(2), meta, 0), failure("INTEGRITY"));
});

test("R2 SDK performs one attempt and sanitizes network/permission errors without fallback", async () => {
  let attempts = 0;
  const transport = r2Transport(r2Config(env()), {
    async handle() {
      attempts++;
      throw new Error("secret credential and private path");
    },
  });
  const request = { kind: "get" as const, key: "synthetic", maxBytes: 64, signal: new AbortController().signal };
  await assert.rejects(transport(request), failure("UNAVAILABLE"));
  assert.equal(attempts, 1);
  await assert.rejects(transport({ ...request, kind: "put", body: jpeg(), metadata: meta, ifNoneMatch: "*" }), failure("UNKNOWN_OUTCOME"));
  assert.equal(attempts, 2);
});

test("R2 SDK supports conditional headers and distinguishes missing key from missing bucket", async () => {
  let responseCode = "NoSuchKey";
  const transport = r2Transport(r2Config(env()), {
    async handle(request: { method: string; headers: Record<string, string> }) {
      if (request.method === "PUT") {
        assert.equal(request.headers["if-none-match"], "*");
        assert.equal(request.headers["cache-control"], "no-store");
        return { response: { statusCode: 200, headers: {}, body: Readable.from([]) } };
      }
      return { response: { statusCode: 404, headers: { "content-type": "application/xml" },
        body: Readable.from([`<Error><Code>${responseCode}</Code><Message>redacted</Message></Error>`]) } };
    },
  });
  const base = { key: "synthetic", maxBytes: 64, signal: new AbortController().signal };
  await assert.rejects(transport({ ...base, kind: "get" }), failure("NOT_FOUND"));
  responseCode = "NoSuchBucket";
  await assert.rejects(transport({ ...base, kind: "get" }), failure("UNAVAILABLE"));
  await transport({ ...base, kind: "put", body: jpeg(), metadata: meta, ifNoneMatch: "*" });
});

test("R2 SDK bounds downloads, closes streams and sanitizes access denial", async () => {
  let mode: "oversize" | "denied" = "oversize";
  let stream: Readable | undefined;
  const transport = r2Transport(r2Config(env()), {
    async handle() {
      stream = Readable.from(mode === "oversize" ? [Buffer.alloc(100)] :
        ["<Error><Code>AccessDenied</Code><Message>private credential</Message></Error>"]);
      return { response: { statusCode: mode === "oversize" ? 200 : 403,
        headers: { "content-type": mode === "oversize" ? "image/jpeg" : "application/xml" }, body: stream } };
    },
  });
  const request = { kind: "get" as const, key: "synthetic", maxBytes: 4, signal: new AbortController().signal };
  await assert.rejects(transport(request), failure("INTEGRITY"));
  assert.equal(stream?.destroyed, true);
  mode = "denied";
  await assert.rejects(transport(request), error => {
    assert.ok(error instanceof R2Error);
    assert.equal(error.message.includes("credential"), false);
    return error.category === "UNAVAILABLE";
  });
});
