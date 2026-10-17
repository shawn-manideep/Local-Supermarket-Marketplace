import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrandingStorageAdapter,
  createPrivateObjectStorageAdapter,
  createProductImageStorageAdapter,
  createReplitObjectStore,
  type ReplitObjectStore,
} from "./replit-object-storage.js";
import type { ReplitObjectStorageClient } from "./replit-object-storage.js";

function memoryStore(): ReplitObjectStore & {
  objects: Map<string, Buffer>;
  failNextPut?: string;
} {
  const objects = new Map<string, Buffer>();
  const store = {
    objects,
    failNextPut: undefined as string | undefined,
    async put(key: string, bytes: Buffer) {
      if (store.failNextPut === key) {
        store.failNextPut = undefined;
        throw new Error("synthetic storage failure");
      }
      objects.set(key, Buffer.from(bytes));
    },
    async get(key: string) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("missing object");
      return Buffer.from(bytes);
    },
    async getOptional(key: string) {
      const bytes = objects.get(key);
      return bytes ? Buffer.from(bytes) : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return store;
}

test("SDK result handling stores and retrieves bytes without exposing object URLs", async () => {
  const objects = new Map<string, Buffer>();
  const client = {
    async uploadFromBytes(name: string, bytes: Buffer) {
      objects.set(name, Buffer.from(bytes));
      return { ok: true, value: null };
    },
    async downloadAsBytes(name: string) {
      const value = objects.get(name);
      return value ? { ok: true, value: [Buffer.from(value)] } : { ok: false, error: {} };
    },
    async exists(name: string) {
      return { ok: true, value: objects.has(name) };
    },
    async delete(name: string) {
      objects.delete(name);
      return { ok: true, value: null };
    },
  } as unknown as ReplitObjectStorageClient;
  const store = createReplitObjectStore(client);
  await store.put("private/vendor-documents/store-1/document-1", Buffer.from("private"));
  assert.equal(
    (await store.get("private/vendor-documents/store-1/document-1")).toString(),
    "private",
  );
  assert.equal(await store.getOptional("private/missing"), null);
  await store.delete("private/vendor-documents/store-1/document-1");
  assert.equal(objects.size, 0);
  await assert.rejects(store.get("../outside"), /Invalid App Storage object path/);
});

test("vendor documents and delivery photos remain in distinct private namespaces", async () => {
  const store = memoryStore();
  const documents = createPrivateObjectStorageAdapter("vendor-documents", store, () => "private");
  const photos = createPrivateObjectStorageAdapter("delivery-photos", store, () => "private");

  await documents.put("private/vendor-documents/store-1/doc-1", Buffer.from("document"));
  await photos.put("private/delivery-photos/partner-1/photo-1", Buffer.from("photo"));

  assert.deepEqual([...store.objects.keys()].sort(), [
    "private/delivery-photos/partner-1/photo-1",
    "private/vendor-documents/store-1/doc-1",
  ]);
  assert.deepEqual(Object.keys(documents).sort(), ["discard", "get", "put"]);
  await assert.rejects(
    documents.get("public/product-images/store-1/image-1"),
    /outside its allowed namespace/,
  );
});

test("product images retain MIME type in a private metadata companion object", async () => {
  const store = memoryStore();
  const images = createProductImageStorageAdapter(store, () => "public");
  const bytes = Buffer.from("jpeg bytes");

  await images.put("store-1", "image-1", bytes, "image/jpeg");
  assert.deepEqual([...store.objects.keys()].sort(), [
    "public/product-images/store-1/image-1",
    "public/product-images/store-1/image-1.metadata.json",
  ]);
  assert.deepEqual(await images.get("store-1", "image-1"), {
    bytes,
    mimeType: "image/jpeg",
  });
  await images.discard("store-1", "image-1");
  assert.equal(store.objects.size, 0);
});

test("branding uses versioned bytes and an atomic manifest; failed replacement keeps old logo", async () => {
  const store = memoryStore();
  const revisions = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const branding = createBrandingStorageAdapter(store, () => "public", () => revisions.shift()!);
  const first = Buffer.from("first logo");
  const second = Buffer.from("second logo");
  const manifest = "public/application-branding/active-logo.manifest.json";

  await branding.put(first, "image/png");
  assert.deepEqual(await branding.metadata(), {
    revision: "11111111-1111-4111-8111-111111111111",
    mimeType: "image/png",
  });
  assert.deepEqual(await branding.get(), { bytes: first, mimeType: "image/png" });

  store.failNextPut = manifest;
  await assert.rejects(branding.put(second, "image/jpeg"), /synthetic storage failure/);
  assert.deepEqual(await branding.get(), { bytes: first, mimeType: "image/png" });
  assert.equal(
    store.objects.has(
      "public/application-branding/active-logo/versions/22222222-2222-4222-8222-222222222222",
    ),
    false,
  );
  await assert.rejects(branding.put(second, "image/svg+xml"), /Unsupported/);
});
