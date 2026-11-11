import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { SupabaseStorageError } from "./supabase-storage.js";
import { syntheticSupabaseEnv } from "./fixtures/fake-supabase-storage.js";

function validEnv(): NodeJS.ProcessEnv {
  const jwt = (role: string, ref = "nrnigsznectrgbgafwme") =>
    `fixture.${Buffer.from(JSON.stringify({ ref, role })).toString("base64url")}.fixture`;
  return {
    ...syntheticSupabaseEnv(),
    API_OBJECT_STORAGE_PROVIDER: "disabled",
    API_ONLY_TARGET_PROFILE: "isolated-native-preview",
    API_VENDOR_DOCUMENT_STORAGE_PROVIDER: "supabase-storage",
    SUPABASE_ANON_KEY: jwt("anon"), SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
    SUPABASE_DB_URL: "postgresql://postgres.nrnigsznectrgbgafwme:fixture@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&connect_timeout=10",
    SESSION_SECRET: "synthetic-session-signing-secret-32-characters",
    MASTER_CATALOG_REVIEW_TOKEN_SECRET: "synthetic-catalog-signing-secret-32-characters",
  };
}

test("Vendor-only dispatch validates before client access and isolates every other category", async t => {
  const env = validEnv();
  const names = [...Object.keys(env), "API_ASSET_STORAGE_PROVIDER"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const apply = (changes: NodeJS.ProcessEnv = {}) => {
    for (const name of names) delete process.env[name];
    for (const [name, value] of Object.entries({ ...env, ...changes })) {
      if (value !== undefined) process.env[name] = value;
    }
  };
  apply();
  const calls: string[] = [];
  const bytes = Buffer.from("%PDF-1.4\nsynthetic\n%%EOF");
  let readError: Error | undefined;
  const ref = `${env.PRIVATE_OBJECT_DIR}/vendor-documents/store-1/document-1`;
  const docs = {
    async put() { calls.push("documents.put"); },
    async get() {
      calls.push("documents.get");
      if (readError) throw readError;
      return bytes;
    },
    async discard() { throw new Error("document erasure must not be reached"); },
  };
  const deny = () => { calls.push("unexpected-provider"); throw new Error("unexpected provider"); };
  const live = mock.module("./supabase-live-assets.js", { namedExports: {
    getSupabaseLiveAssets: () => {
      calls.push("client");
      return { documents: docs, photos: { put: deny, get: deny, discard: deny },
        products: { put: deny, get: deny, discard: deny } };
    },
  } });
  const r2 = mock.module("./r2-assets.js", { namedExports: { getR2Assets: deny } });
  const legacy = mock.module("./replit-object-storage.js", { namedExports: {
    getReplitObjectStore: async () => { calls.push("legacy-client"); return {}; },
    createPrivateObjectStorageAdapter: () => ({
      async put() { calls.push("legacy.put"); },
      async get() { calls.push("legacy.get"); return bytes; },
      async discard() { calls.push("legacy.discard"); },
    }),
    createProductImageStorageAdapter: deny,
    createBrandingStorageAdapter: deny,
  } });
  try {
    const { documentStorage, privateObjectStorage } = await import("../vendor-documents/storage.js");
    const { productImageStorage } = await import("../product-images/storage.js");
    const { brandingStorage } = await import("../branding/storage.js");

    await t.test("valid disabled-base configuration enables only documents; deletion needs no client", async () => {
      calls.length = 0;
      await documentStorage.put(ref, bytes, "application/pdf");
      assert.deepEqual(await documentStorage.get(ref), bytes);
      assert.deepEqual(calls, ["client", "documents.put", "client", "documents.get"]);
      calls.length = 0;
      await assert.rejects(documentStorage.discard(ref), /CAPABILITY_UNAVAILABLE/);
      assert.deepEqual(calls, []);
      const photos = privateObjectStorage("delivery-photos");
      for (const operation of [
        () => productImageStorage.put("store-1", "image-1", bytes, "image/png"),
        () => productImageStorage.get("store-1", "image-1"),
        () => productImageStorage.discard("store-1", "image-1"),
        () => photos.put(ref, bytes, "image/jpeg"), () => photos.get(ref), () => photos.discard(ref),
        () => brandingStorage.put(bytes, "image/png"),
        () => brandingStorage.get(), () => brandingStorage.metadata(),
      ]) await assert.rejects(operation(), /Storage is unavailable/);
      assert.deepEqual(calls, []);
      assert.equal(process.env.API_OBJECT_STORAGE_PROVIDER, "disabled");
      assert.equal(process.env.API_ASSET_STORAGE_PROVIDER, undefined);
    });

    await t.test("invalid selectors, target/key/TLS/signing failures and missing roots never access clients", async () => {
      const wrongKey = `fixture.${Buffer.from(JSON.stringify({ ref: "gkwcolipeavxnuzqlamb",
        role: "service_role" })).toString("base64url")}.fixture`;
      const invalid: NodeJS.ProcessEnv[] = [
        { API_VENDOR_DOCUMENT_STORAGE_PROVIDER: "" },
        { API_VENDOR_DOCUMENT_STORAGE_PROVIDER: "other" },
        { API_ASSET_STORAGE_PROVIDER: "supabase-storage" },
        { API_ASSET_STORAGE_PROVIDER: "" },
        { API_OBJECT_STORAGE_PROVIDER: "cloudflare-r2" },
        { API_ONLY_TARGET_PROFILE: undefined }, { API_ONLY_TARGET_PROFILE: "other" },
        { API_ONLY_TARGET_PROFILE: "original-customer-apk" },
        { SUPABASE_URL: "https://gkwcolipeavxnuzqlamb.supabase.co" },
        { SUPABASE_SERVICE_ROLE_KEY: wrongKey },
        { SUPABASE_SERVICE_ROLE_KEY: undefined },
        { SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_ANON_KEY },
        { SUPABASE_ANON_KEY: wrongKey },
        { SUPABASE_DB_URL: env.SUPABASE_DB_URL!.replace("verify-full", "disable") },
        { SUPABASE_DB_URL: env.SUPABASE_DB_URL! + "&host=other.invalid" },
        { SESSION_SECRET: undefined }, { MASTER_CATALOG_REVIEW_TOKEN_SECRET: undefined },
        ...["SUPABASE_STORAGE_BUCKET", "SUPABASE_STORAGE_PUBLIC_REFERENCE_ROOT",
          "SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT", "PUBLIC_OBJECT_SEARCH_PATHS", "PRIVATE_OBJECT_DIR"]
          .map(name => ({ [name]: undefined })),
      ];
      for (const changes of invalid) {
        apply(changes);
        calls.length = 0;
        await assert.rejects(documentStorage.put(ref, bytes, "application/pdf"));
        await assert.rejects(documentStorage.get(ref));
        await assert.rejects(documentStorage.discard(ref));
        assert.deepEqual(calls, []);
      }
      apply();
    });

    await t.test("disabled base never falls back, including explicit missing documents", async () => {
      for (const error of [
        new SupabaseStorageError("NOT_FOUND"), new SupabaseStorageError("UNAVAILABLE"),
        new SupabaseStorageError("TIMEOUT"), new SupabaseStorageError("UNKNOWN_OUTCOME"),
        new Error("synthetic untyped provider failure"),
      ]) {
        calls.length = 0;
        readError = error;
        await assert.rejects(documentStorage.get(ref), value => value === error);
        assert.deepEqual(calls, ["client", "documents.get"]);
      }
      readError = undefined;
    });

    await t.test("enabled legacy provider falls back only on explicit not-found", async () => {
      apply({
        API_OBJECT_STORAGE_PROVIDER: "replit-app-storage",
        PRIVATE_OBJECT_DIR: "private", PUBLIC_OBJECT_SEARCH_PATHS: "public",
        SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT: "private",
        SUPABASE_STORAGE_PUBLIC_REFERENCE_ROOT: "public",
      });
      calls.length = 0;
      readError = new SupabaseStorageError("NOT_FOUND");
      assert.deepEqual(await documentStorage.get("private/vendor-documents/store-1/document-1"), bytes);
      assert.deepEqual(calls, ["client", "documents.get", "legacy-client", "legacy.get"]);
      for (const error of [
        new SupabaseStorageError("UNAVAILABLE"), new SupabaseStorageError("TIMEOUT"),
        new SupabaseStorageError("UNKNOWN_OUTCOME"), new SupabaseStorageError("INVALID_INPUT"),
        new Error("synthetic authorization/provider failure"),
      ]) {
        calls.length = 0;
        readError = error;
        await assert.rejects(documentStorage.get("private/vendor-documents/store-1/document-1"));
        assert.deepEqual(calls, ["client", "documents.get"]);
      }
      calls.length = 0;
      await assert.rejects(documentStorage.discard(ref), /CAPABILITY_UNAVAILABLE/);
      assert.deepEqual(calls, []);
      readError = undefined;
      apply();
    });

    await t.test("unset selector preserves disabled denial and existing enabled legacy routing", async () => {
      apply({ API_VENDOR_DOCUMENT_STORAGE_PROVIDER: undefined });
      calls.length = 0;
      await assert.rejects(documentStorage.put(ref, bytes, "application/pdf"), /Storage is unavailable/);
      await assert.rejects(documentStorage.get(ref), /Storage is unavailable/);
      await assert.rejects(documentStorage.discard(ref), /Storage is unavailable/);
      assert.deepEqual(calls, []);
      apply({ API_VENDOR_DOCUMENT_STORAGE_PROVIDER: undefined, API_OBJECT_STORAGE_PROVIDER: "replit-app-storage" });
      assert.deepEqual(await documentStorage.get(ref), bytes);
      assert.deepEqual(calls, ["legacy-client", "legacy.get"]);
    });
  } finally {
    live.restore(); legacy.restore(); r2.restore();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
