import assert from "node:assert/strict";
import { Blob } from "node:buffer";
import test from "node:test";
import { createSupabaseLiveAssets } from "./supabase-live-assets.js";
import { fixtureSupabaseConfig } from "./fixtures/fake-supabase-storage.js";
import { createSupabaseVendorDocuments, documentFetch } from "./supabase-vendor-documents.js";
import { SupabaseStorageError } from "./supabase-storage.js";
import { readWithNotFoundFallback } from "./asset-storage-fallback.js";
import { readFile } from "node:fs/promises";


const config = fixtureSupabaseConfig();

function pdfFixture() {
  return Buffer.from("%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF");
}

function jpegFixture() {
  const bytes = Buffer.alloc(20);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[18] = 0xff;
  bytes[19] = 0xd9;
  return bytes;
}

function pngFixture() {
  const bytes = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(1, 16);
  bytes.writeUInt32BE(1, 20);
  bytes.write("IEND", 37);
  return bytes;
}

function webpFixture() {
  const bytes = Buffer.alloc(20);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(12, 4);
  bytes.write("WEBP", 8);
  bytes.write("VP8 ", 12);
  return bytes;
}

function fakeClient() {
  const objects = new Map<string, { bytes: Buffer; mimeType: string }>();
  const operations: Array<{ operation: string; key: string; options?: unknown }> = [];

  const bucket = {
    async upload(key: string, bytes: Buffer, options: { upsert: boolean; contentType: string }) {
      operations.push({ operation: "upload", key, options });

      if (objects.has(key)) return { error: { status: 409 } };

      objects.set(key, { bytes: Buffer.from(bytes), mimeType: options.contentType });
      return { error: null };
    },

    async download(key: string) {
      operations.push({ operation: "download", key });
      const object = objects.get(key);

      if (!object) return { data: null, error: { status: 404, code: "NoSuchKey" } };

      return {
        data: new Blob([Uint8Array.from(object.bytes)], { type: object.mimeType }),
        error: null,
      };
    },

    async info(key: string) {
      operations.push({ operation: "info", key });
      if (!objects.has(key)) {
        return { data: null, error: { status: 404, code: "NoSuchKey" } };
      }
      return { data: { name: key }, error: null };
    },

    async remove(keys: string[]) {
      for (const key of keys) {
        operations.push({ operation: "remove", key });
        objects.delete(key);
      }
      return { error: null };
    },
  };

  const client = {
    storage: {
      from(name: string) {
        assert.equal(name, config.bucket);
        return bucket;
      },
    },
  };

  return {
    assets: createSupabaseLiveAssets(client as never, config),
    client,
    bucket,
    objects,
    operations,
  };
}

test("live adapter uploads and downloads private vendor documents using existing references", async () => {
  const f = fakeClient();
  const bytes = pdfFixture();
  const ref = `/${config.privateRoot}/vendor-documents/store-1/document-1`;

  await f.assets.documents.put(ref, bytes, "application/pdf");

  const key = `${config.privateRoot}/vendor-documents/store-1/document-1`;
  assert.ok(f.objects.has(key));
  assert.equal(f.operations[0].operation, "upload");
  assert.deepEqual(await f.assets.documents.get(ref), bytes);
});

test("live adapter stores and retrieves delivery photos in their separate private namespace", async () => {
  const f = fakeClient();
  const bytes = jpegFixture();
  const ref = `/${config.privateRoot}/delivery-photos/partner-1/photo-1`;

  await f.assets.photos.put(ref, bytes, "image/jpeg");

  assert.ok(f.objects.has(`${config.privateRoot}/delivery-photos/partner-1/photo-1`));
  assert.deepEqual(await f.assets.photos.get(ref), bytes);
});

test("live adapter stores product images under the existing public reference root", async () => {
  const f = fakeClient();
  const bytes = webpFixture();

  await f.assets.products.put("store-1", "image-1", bytes, "image/webp");

  const key = `${config.publicRoot}/product-images/store-1/image-1`;
  assert.ok(f.objects.has(key));
  assert.deepEqual(await f.assets.products.get("store-1", "image-1"), {
    bytes,
    mimeType: "image/webp",
  });
});

test("uploads are create-only and duplicate objects return a conflict", async () => {
  const f = fakeClient();
  const ref = `/${config.privateRoot}/vendor-documents/store-1/document-2`;
  const bytes = pdfFixture();

  await f.assets.documents.put(ref, bytes, "application/pdf");

  await assert.rejects(
    f.assets.documents.put(ref, pdfFixture(), "application/pdf"),
    /CONFLICT/,
  );

  assert.equal(f.operations.filter(item => item.operation === "upload").length, 2);
  assert.equal(f.objects.get(`${config.privateRoot}/vendor-documents/store-1/document-2`)?.bytes.toString(), pdfFixture().toString());
});

test("invalid references and unsupported MIME types are rejected before storage operations", async () => {
  const f = fakeClient();

  await assert.rejects(
    f.assets.documents.get(`/${config.privateRoot}/delivery-photos/store-1/photo-1`),
    /INVALID_INPUT/,
  );

  await assert.rejects(
    f.assets.photos.put(`/${config.privateRoot}/delivery-photos/store-1/photo-2`, Buffer.from("not a real file"), "application/pdf"),
    /INVALID_INPUT/,
  );

  await assert.rejects(
    f.assets.products.put("store-1", "image-2", Buffer.from("not a real file"), "application/pdf"),
    /INVALID_INPUT/,
  );

  assert.equal(f.operations.length, 0);
});

test("live adapter deletes only the explicitly requested object", async () => {
  const f = fakeClient();
  const ref = `/${config.privateRoot}/delivery-photos/partner-1/photo-3`;

  await f.assets.photos.put(ref, jpegFixture(), "image/jpeg");
  await f.assets.photos.discard(ref);

  assert.equal(f.objects.has(`${config.privateRoot}/delivery-photos/partner-1/photo-3`), false);
  assert.equal(f.operations.at(-1)?.operation, "remove");
});

test("missing objects return a safe not-found error", async () => {
  const f = fakeClient();
  const ref = `/${config.privateRoot}/vendor-documents/store-1/missing`;

  await assert.rejects(f.assets.documents.get(ref), /NOT_FOUND/);
});


test("object inspection distinguishes existing and missing Supabase objects", async () => {
  const f = fakeClient();
  const ref = `/${config.privateRoot}/vendor-documents/store-1/document-3`;

  assert.equal(await f.assets.documents.has(ref), false);

  await f.assets.documents.put(ref, pdfFixture(), "application/pdf");

  assert.equal(await f.assets.documents.has(ref), true);
});


test("live adapter accepts valid PNG product images", async () => {
  const f = fakeClient();
  const bytes = pngFixture();

  await f.assets.products.put("store-1", "png-image-1", bytes, "image/png");

  assert.deepEqual(
    await f.assets.products.get("store-1", "png-image-1"),
    { bytes, mimeType: "image/png" },
  );
});

test("invalid file signatures are rejected before upload", async () => {
  const f = fakeClient();
  const ref = `/${config.privateRoot}/vendor-documents/store-1/invalid-pdf`;

  await assert.rejects(
    f.assets.documents.put(ref, Buffer.from("not a PDF"), "application/pdf"),
    /INVALID_INPUT/,
  );

  assert.equal(f.operations.length, 0);
});

test("corrupted stored objects are rejected during download", async () => {
  const f = fakeClient();
  const ref = `/${config.privateRoot}/vendor-documents/store-1/corrupted`;
  const key = `${config.privateRoot}/vendor-documents/store-1/corrupted`;

  f.objects.set(key, {
    bytes: Buffer.from("not a PDF"),
    mimeType: "application/pdf",
  });

  await assert.rejects(f.assets.documents.get(ref), /UNAVAILABLE/);
});

const documentRef = `/${config.privateRoot}/vendor-documents/store-1/hardened-document`;
const documentKey = documentRef.slice(1);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("document upload verifies before resolving and snapshots caller-owned bytes", async () => {
  const f = fakeClient();
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const originalDownload = f.bucket.download.bind(f.bucket);
  Object.assign(f.bucket, { download: async (key: string) => { await ready; return originalDownload(key); } });
  const input = pdfFixture();
  const expected = Buffer.from(input);
  let completed = false;
  const write = f.assets.documents.put(documentRef, input, "application/pdf").then(() => { completed = true; });
  input.fill(0);
  await delay(1);
  assert.equal(completed, false);
  release();
  await write;
  assert.deepEqual(f.objects.get(documentKey)?.bytes, expected);
  assert.deepEqual(f.operations.map(item => item.operation), ["upload", "download"]);
});

test("document verification rejects same-length checksum mismatch without cleanup", async () => {
  const f = fakeClient();
  const corrupt = pdfFixture();
  corrupt[10] ^= 1; // Still an accepted PDF signature.
  Object.assign(f.bucket, { download: async () => ({
    data: new Blob([Uint8Array.from(corrupt)], { type: "application/pdf" }), error: null,
  }) });
  await assert.rejects(f.assets.documents.put(documentRef, pdfFixture(), "application/pdf"), /UNAVAILABLE/);
  assert.equal(f.objects.has(documentKey), true);
  assert.deepEqual(f.operations.map(item => item.operation), ["upload"]);
});

test("document verification rejects wrong length, MIME, missing and unavailable read-back", async () => {
  for (const result of [
    { data: new Blob([Uint8Array.from(Buffer.concat([pdfFixture(), Buffer.from("x")]))], { type: "application/pdf" }), error: null },
    { data: new Blob([Uint8Array.from(pdfFixture())], { type: "image/png" }), error: null },
    { data: null, error: { status: 404, code: "NoSuchKey" } },
    { data: null, error: { status: 503, message: "sensitive-provider-details" } },
  ]) {
    const f = fakeClient();
    Object.assign(f.bucket, { download: async () => result });
    await assert.rejects(f.assets.documents.put(documentRef, pdfFixture(), "application/pdf"), /UNAVAILABLE/);
    assert.equal(f.objects.has(documentKey), true);
    assert.equal(f.operations.some(item => item.operation === "remove"), false);
  }
});

test("ambiguous document upload commits once, never verifies, retries or deletes", async () => {
  const f = fakeClient();
  const upload = f.bucket.upload.bind(f.bucket);
  Object.assign(f.bucket, { upload: async (...args: Parameters<typeof upload>) => {
    await upload(...args);
    throw new Error("secret-provider-url");
  } });
  await assert.rejects(f.assets.documents.put(documentRef, pdfFixture(), "application/pdf"), error =>
    error instanceof SupabaseStorageError && error.code === "UNKNOWN_OUTCOME" && !error.message.includes("secret"));
  assert.equal(f.objects.has(documentKey), true);
  assert.deepEqual(f.operations.map(item => item.operation), ["upload"]);
});

test("document upload deadline aborts only its operation and prevents late verification", async () => {
  const f = fakeClient();
  const upload = f.bucket.upload.bind(f.bucket);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let signal!: AbortSignal;
  Object.assign(f.bucket, { upload: async (...args: Parameters<typeof upload>) => {
    await pending;
    return upload(...args);
  } });
  const docs = createSupabaseVendorDocuments(value => { signal = value; return f.client as never; }, config, { timeoutMs: 15 });
  await assert.rejects(docs.put(documentRef, pdfFixture(), "application/pdf"), /UNKNOWN_OUTCOME/);
  assert.equal(signal.aborted, true);
  release();
  await delay(5);
  assert.equal(f.objects.has(documentKey), true);
  assert.deepEqual(f.operations.map(item => item.operation), ["upload"]);
  // Other categories continue to use their existing independent client path.
  await f.assets.photos.put(`/${config.privateRoot}/delivery-photos/partner-1/independent`, jpegFixture(), "image/jpeg");
});

test("verification timeout retains acknowledged upload and read timeout does not imply absence", async () => {
  const f = fakeClient();
  Object.assign(f.bucket, { download: () => new Promise(() => undefined) });
  const docs = createSupabaseVendorDocuments(() => f.client as never, config, { timeoutMs: 15 });
  await assert.rejects(docs.put(documentRef, pdfFixture(), "application/pdf"), /UNKNOWN_OUTCOME/);
  assert.equal(f.objects.has(documentKey), true);
  await assert.rejects(docs.get(documentRef), /TIMEOUT/);
  assert.equal(f.operations.some(item => item.operation === "remove"), false);
});

test("legacy retrieval is used only for explicit object not-found, never other document failures", async () => {
  for (const providerError of [
    { status: 401 }, { status: 403 }, { status: 404, code: "NoSuchBucket" },
    { status: 500 }, { status: 404 }, { status: "404", code: "other" },
  ]) {
    const f = fakeClient();
    Object.assign(f.bucket, { download: async () => ({ data: null, error: providerError }) });
    let legacyCalls = 0;
    await assert.rejects(readWithNotFoundFallback(() => f.assets.documents.get(documentRef), async () => {
      legacyCalls++; return pdfFixture();
    }), /UNAVAILABLE/);
    assert.equal(legacyCalls, 0);
  }
  const f = fakeClient();
  let legacyCalls = 0;
  assert.deepEqual(await readWithNotFoundFallback(() => f.assets.documents.get(documentRef), async () => {
    legacyCalls++; return pdfFixture();
  }), pdfFixture());
  assert.equal(legacyCalls, 1);
});

test("integrity failure and timeout never trigger legacy retrieval", async () => {
  for (const hang of [false, true]) {
    const f = fakeClient();
    Object.assign(f.bucket, { download: async () => hang ? new Promise(() => undefined) :
      { data: new Blob(["invalid"], { type: "application/pdf" }), error: null } });
    const docs = createSupabaseVendorDocuments(() => f.client as never, config, { timeoutMs: 15 });
    let legacyCalls = 0;
    await assert.rejects(readWithNotFoundFallback(() => docs.get(documentRef), async () => {
      legacyCalls++; return pdfFixture();
    }));
    assert.equal(legacyCalls, 0);
  }
});

test("document discard fails closed without provider I/O", async () => {
  const f = fakeClient();
  await f.assets.documents.put(documentRef, pdfFixture(), "application/pdf");
  const before = f.operations.length;
  await assert.rejects(f.assets.documents.discard(documentRef), /CAPABILITY_UNAVAILABLE/);
  assert.equal(f.operations.length, before);
  assert.equal(f.objects.has(documentKey), true);
  const wrapper = await readFile(new URL("../vendor-documents/storage.ts", import.meta.url), "utf8");
  const discard = wrapper.slice(wrapper.indexOf("async discard(ref"));
  assert.ok(discard.indexOf('if (area === "vendor-documents") throw') < discard.indexOf("discardFromOwningStore("));
});

test("document fetch bounds streaming responses and cancels on overflow", async () => {
  let cancelled = false;
  const transport: typeof fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(documentFetch(new AbortController().signal, transport)("https://offline.invalid/file"), /UNAVAILABLE/);
  await delay(0);
  assert.equal(cancelled, true);
});

test("document fetch forwards abort, denies repeated mutations and never follows redirects", async () => {
  const controller = new AbortController();
  let calls = 0;
  const transport: typeof fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.redirect, "error");
    return new Response("ok");
  };
  const bounded = documentFetch(controller.signal, transport);
  await bounded("https://offline.invalid/file", { method: "POST" });
  await assert.rejects(bounded("https://offline.invalid/file", { method: "POST" }), /UNAVAILABLE/);
  assert.equal(calls, 1);
  controller.abort();
  await assert.rejects(bounded("https://offline.invalid/file"), /UNAVAILABLE/);
  assert.equal(calls, 1);
});

test("malformed metadata and duplicate document keys never mean missing", async () => {
  const f = fakeClient();
  Object.assign(f.bucket, { info: async () => ({ data: null, error: null }) });
  await assert.rejects(f.assets.documents.has(documentRef), /UNAVAILABLE/);
  await f.assets.documents.put(documentRef, pdfFixture(), "application/pdf");
  await assert.rejects(f.assets.documents.put(documentRef, pdfFixture(), "application/pdf"), /CONFLICT/);
  assert.deepEqual(f.objects.get(documentKey)?.bytes, pdfFixture());
});
