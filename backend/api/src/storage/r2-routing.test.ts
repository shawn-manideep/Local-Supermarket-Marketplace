import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { R2Error, type R2Transport } from "./r2-store.js";

test("global and photo-only R2 construction keep category boundaries and validate before clients", async t => {
  const jwt = (role: string) => `fixture.${Buffer.from(JSON.stringify({
    ref: "nrnigsznectrgbgafwme", role,
  })).toString("base64url")}.fixture`;
  const env: NodeJS.ProcessEnv = {
    API_OBJECT_STORAGE_PROVIDER: "cloudflare-r2",
    API_ONLY_TARGET_PROFILE: "isolated-native-preview",
    SUPABASE_URL: "https://nrnigsznectrgbgafwme.supabase.co",
    SUPABASE_ANON_KEY: jwt("anon"), SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
    SUPABASE_DB_URL: "postgresql://postgres.nrnigsznectrgbgafwme:fixture@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&connect_timeout=10",
    SESSION_SECRET: "synthetic-session-signing-secret-32-characters",
    MASTER_CATALOG_REVIEW_TOKEN_SECRET: "synthetic-catalog-signing-secret-32-characters",
    R2_RUNTIME_APPROVAL: "approved-for-runtime", R2_BUCKET_ACCESS: "private",
    R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "b".repeat(32),
    R2_SECRET_ACCESS_KEY: "c".repeat(64), R2_BUCKET: "synthetic-bucket",
    R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
    R2_OBJECT_PREFIX: "alb-r2", R2_PRIVATE_REFERENCE_ROOT: "legacy/private",
    R2_PUBLIC_REFERENCE_ROOT: "legacy/public", PRIVATE_OBJECT_DIR: "legacy/private",
    PUBLIC_OBJECT_SEARCH_PATHS: "legacy/public",
  };
  const names = [...Object.keys(env), "API_DELIVERY_PHOTO_STORAGE_PROVIDER", "API_ASSET_STORAGE_PROVIDER"];
  const saved = Object.fromEntries(names.map(k => [k, process.env[k]]));
  const apply = (changes: NodeJS.ProcessEnv = {}) => {
    for (const name of names) delete process.env[name];
    for (const [name, value] of Object.entries({ ...env, ...changes })) {
      if (value !== undefined) process.env[name] = value;
    }
  };
  apply();
  let clients = 0, requests = 0, sequence = 0;
  const objects = new Map<string, { body: Buffer; etag: string }>();
  const transport: R2Transport = async request => {
    requests++;
    const old = objects.get(request.key);
    if (request.kind === "get") {
      if (!old) throw new R2Error("NOT_FOUND");
      return { body: Buffer.from(old.body), etag: old.etag };
    }
    if (request.ifNoneMatch === "*" && old || request.ifMatch && request.ifMatch !== old?.etag) {
      throw new R2Error("CONFLICT");
    }
    assert.ok(request.ifMatch || request.ifNoneMatch);
    objects.set(request.key, { body: Buffer.from(request.body!), etag: `"opaque-${++sequence}"` });
    return {};
  };
  const moduleMock = mock.module("./r2-transport.js", {
    namedExports: { r2Transport: () => { clients++; return transport; } },
  });
  try {
    const { getR2DeliveryPhotoAssets } = await import("./r2-assets.js");
    const { productImageStorage } = await import("../product-images/storage.js");
    const { documentStorage, privateObjectStorage } = await import("../vendor-documents/storage.js");
    const { brandingStorage } = await import("../branding/storage.js");
    const photos = privateObjectStorage("delivery-photos");
    const bytes = Buffer.from([255,216,255,...Array(20).fill(1),255,217]);
    await t.test("existing global R2 dispatch still handles all four categories", async () => {
      await productImageStorage.put("store", "image", bytes, "image/jpeg");
      assert.deepEqual(await productImageStorage.get("store", "image"), { bytes, mimeType: "image/jpeg" });
      await productImageStorage.discard("store", "image");
      for (const [adapter, area] of [[documentStorage, "vendor-documents"], [photos, "delivery-photos"]] as const) {
        const ref = `legacy/private/${area}/owner/image`;
        await adapter.put(ref, bytes, "image/jpeg");
        assert.deepEqual(await adapter.get(ref), bytes);
        await adapter.discard(ref);
      }
      await brandingStorage.put(bytes, "image/jpeg");
      assert.equal((await brandingStorage.metadata())?.mimeType, "image/jpeg");
      assert.deepEqual((await brandingStorage.get())?.bytes, bytes);
      assert.equal(clients, 1);
    });
    await t.test("photo-only selection constructs separately and cannot activate other categories", async () => {
      apply({ API_OBJECT_STORAGE_PROVIDER: "disabled", API_DELIVERY_PHOTO_STORAGE_PROVIDER: "cloudflare-r2" });
      const ref = "legacy/private/delivery-photos/assignment/photo";
      await photos.put(ref, bytes, "image/jpeg");
      assert.deepEqual(await photos.get(ref), bytes);
      await photos.discard(ref);
      await assert.rejects(photos.get(ref), /NOT_FOUND/);
      await assert.rejects(photos.put(ref, bytes, "image/jpeg"), /CONFLICT/);
      assert.equal(clients, 2);
      const before = requests;
      for (const action of [
        () => documentStorage.put(ref, bytes, "image/jpeg"),
        () => documentStorage.get(ref), () => documentStorage.discard(ref),
        () => productImageStorage.put("store", "other", bytes, "image/jpeg"),
        () => productImageStorage.get("store", "image"), () => productImageStorage.discard("store", "image"),
        () => brandingStorage.put(bytes, "image/jpeg"), () => brandingStorage.get(), () => brandingStorage.metadata(),
        () => photos.get("legacy/private/vendor-documents/owner/image"),
      ]) await assert.rejects(action());
      assert.equal(requests, before);
    });
    await t.test("invalid settings fail before client construction or I/O, including cache hits", async () => {
      const before = requests, beforeClients = clients;
      for (const changes of [
        { API_DELIVERY_PHOTO_STORAGE_PROVIDER: undefined },
        { API_DELIVERY_PHOTO_STORAGE_PROVIDER: "" }, { R2_BUCKET: undefined },
        { R2_PRIVATE_REFERENCE_ROOT: undefined }, { PRIVATE_OBJECT_DIR: undefined },
        { SUPABASE_SERVICE_ROLE_KEY: "invalid" }, { R2_RUNTIME_APPROVAL: undefined },
        { API_ASSET_STORAGE_PROVIDER: "supabase-storage" },
      ]) {
        apply({ API_OBJECT_STORAGE_PROVIDER: "disabled", API_DELIVERY_PHOTO_STORAGE_PROVIDER: "cloudflare-r2", ...changes });
        assert.throws(() => getR2DeliveryPhotoAssets());
        await assert.rejects(photos.get("legacy/private/delivery-photos/assignment/photo"));
      }
      assert.equal(requests, before); assert.equal(clients, beforeClients);
      apply({ API_OBJECT_STORAGE_PROVIDER: "disabled", API_DELIVERY_PHOTO_STORAGE_PROVIDER: "cloudflare-r2", R2_BUCKET: "different-bucket" });
      getR2DeliveryPhotoAssets();
      assert.equal(clients, beforeClients + 1, "a valid bucket change must not reuse an old client");
    });
  } finally {
    moduleMock.restore();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
