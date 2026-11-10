import assert from "node:assert/strict";
import { Blob } from "node:buffer";
import test from "node:test";
import { createSupabaseLiveAssets } from "./supabase-live-assets.js";
import { fixtureSupabaseConfig } from "./fixtures/fake-supabase-storage.js";


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

  await assert.rejects(f.assets.documents.get(ref), /INVALID_INPUT/);
});
