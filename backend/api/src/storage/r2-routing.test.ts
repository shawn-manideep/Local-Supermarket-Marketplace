import assert from "node:assert/strict";
import { mock, test } from "node:test";

test("all four runtime asset adapters select R2 without reaching other providers", async () => {
  // The fixture runner supplies a scrubbed environment. Every credential is synthetic.
  const env: NodeJS.ProcessEnv = {
    API_OBJECT_STORAGE_PROVIDER: "cloudflare-r2", R2_RUNTIME_APPROVAL: "approved-for-runtime",
    R2_BUCKET_ACCESS: "private", R2_ACCOUNT_ID: "a".repeat(32),
    R2_ACCESS_KEY_ID: "b".repeat(32), R2_SECRET_ACCESS_KEY: "c".repeat(64),
    R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`, R2_BUCKET: "synthetic-bucket",
    R2_OBJECT_PREFIX: "alb-r2", R2_PRIVATE_REFERENCE_ROOT: "legacy/private",
    R2_PUBLIC_REFERENCE_ROOT: "legacy/public", PRIVATE_OBJECT_DIR: "legacy/private",
    PUBLIC_OBJECT_SEARCH_PATHS: "legacy/public",
  };
  const before = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const calls: string[] = [];
  const bytes = Buffer.from("synthetic adapter dispatch only");
  const privatePort = (name: string) => ({
    put: async () => { calls.push(`${name}.put`); },
    get: async () => { calls.push(`${name}.get`); return bytes; },
    discard: async () => { calls.push(`${name}.discard`); },
  });
  const assets = {
    products: { ...privatePort("products"), get: async () => { calls.push("products.get"); return { bytes, mimeType: "image/jpeg" }; } },
    documents: privatePort("documents"), photos: privatePort("photos"),
    branding: {
      put: async () => { calls.push("branding.put"); },
      get: async () => { calls.push("branding.get"); return { bytes, mimeType: "image/jpeg" }; },
      metadata: async () => { calls.push("branding.metadata"); return { revision: "synthetic", mimeType: "image/jpeg" }; },
    },
  };
  const moduleMock = mock.module("./r2-assets.js", { namedExports: { getR2Assets: () => assets } });
  try {
    const { productImageStorage } = await import("../product-images/storage.js");
    const { documentStorage, privateObjectStorage } = await import("../vendor-documents/storage.js");
    const { brandingStorage } = await import("../branding/storage.js");
    await productImageStorage.put("store", "image", bytes, "image/jpeg");
    assert.deepEqual(await productImageStorage.get("store", "image"), { bytes, mimeType: "image/jpeg" });
    await productImageStorage.discard("store", "image");
    for (const adapter of [documentStorage, privateObjectStorage("delivery-photos")]) {
      await adapter.put("synthetic", bytes, "image/jpeg");
      assert.deepEqual(await adapter.get("synthetic"), bytes);
      await adapter.discard("synthetic");
    }
    await brandingStorage.put(bytes, "image/jpeg");
    assert.equal((await brandingStorage.metadata())?.revision, "synthetic");
    await brandingStorage.get();
    assert.deepEqual(calls, [
      "products.put", "products.get", "products.discard",
      "documents.put", "documents.get", "documents.discard",
      "photos.put", "photos.get", "photos.discard",
      "branding.put", "branding.metadata", "branding.get",
    ]);
    process.env.API_OBJECT_STORAGE_PROVIDER = "disabled";
    process.env.API_ONLY_TARGET_PROFILE = "isolated-native-preview";
    await assert.rejects(productImageStorage.get("store", "image"), /Storage is unavailable/);
    await assert.rejects(documentStorage.get("synthetic"), /Storage is unavailable/);
    await assert.rejects(brandingStorage.get(), /Storage is unavailable/);
    assert.equal(calls.length, 12);
    delete process.env.API_ONLY_TARGET_PROFILE;
  } finally {
    moduleMock.restore();
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
