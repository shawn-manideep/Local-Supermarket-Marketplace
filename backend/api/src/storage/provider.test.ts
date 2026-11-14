import assert from "node:assert/strict";
import test from "node:test";
import { syntheticSupabaseEnv } from "./fixtures/fake-supabase-storage.js";
import {
  getApiObjectStorageProvider,
  getApiAssetStorageProvider,
  getApiVendorDocumentStorageProvider,
  getApiDeliveryPhotoStorageProvider,
  selectApiObjectStorage,
  assertStorageOperationsEnabled,
  STORAGE_UNAVAILABLE_MESSAGE,
} from "./provider.js";

test("the unset storage provider preserves the Replit GCS sidecar default", () => {
  assert.equal(getApiObjectStorageProvider({}), "replit-gcs-sidecar");
  assert.equal(
    selectApiObjectStorage({}, { replitGcsSidecar: "sidecar", replitAppStorage: "sdk" }),
    "sidecar",
  );
});

function vendorEnv(): NodeJS.ProcessEnv {
  const jwt = (role: string) => `fixture.${Buffer.from(JSON.stringify({
    ref: "nrnigsznectrgbgafwme", role,
  })).toString("base64url")}.fixture`;
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

function photoEnv(): NodeJS.ProcessEnv {
  return {
    ...vendorEnv(),
    API_DELIVERY_PHOTO_STORAGE_PROVIDER: "cloudflare-r2",
    R2_RUNTIME_APPROVAL: "approved-for-runtime", R2_BUCKET_ACCESS: "private",
    R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "b".repeat(32),
    R2_SECRET_ACCESS_KEY: "c".repeat(64), R2_BUCKET: "synthetic-bucket",
    R2_ENDPOINT: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
    R2_OBJECT_PREFIX: "photo-r2",
    R2_PUBLIC_REFERENCE_ROOT: vendorEnv().PUBLIC_OBJECT_SEARCH_PATHS,
    R2_PRIVATE_REFERENCE_ROOT: vendorEnv().PRIVATE_OBJECT_DIR,
  };
}

test("Delivery photo opt-in preserves disabled defaults and the independent Vendor exception", () => {
  assert.equal(getApiDeliveryPhotoStorageProvider({}), undefined);
  const env = photoEnv();
  assert.equal(getApiDeliveryPhotoStorageProvider(env), "cloudflare-r2");
  assert.equal(getApiObjectStorageProvider(env), "disabled");
  assert.equal(getApiVendorDocumentStorageProvider(env), "supabase-storage");
  assert.throws(() => assertStorageOperationsEnabled(env), /Storage is unavailable/);
});

test("Delivery photo selector rejects invalid values, targets, TLS and incomplete R2 configuration", () => {
  const env = photoEnv();
  for (const value of ["", "disabled", "supabase-storage", "CLOUDFLARE-R2"]) {
    assert.throws(() => getApiDeliveryPhotoStorageProvider({
      ...env, API_DELIVERY_PHOTO_STORAGE_PROVIDER: value,
    }), /API_DELIVERY_PHOTO_STORAGE_PROVIDER/);
  }
  for (const changes of [
    { API_OBJECT_STORAGE_PROVIDER: undefined }, { API_OBJECT_STORAGE_PROVIDER: "cloudflare-r2" },
    { API_ONLY_TARGET_PROFILE: "original-customer-apk" }, { API_ASSET_STORAGE_PROVIDER: "" },
    { SUPABASE_URL: "https://gkwcolipeavxnuzqlamb.supabase.co" },
    { SUPABASE_SERVICE_ROLE_KEY: "invalid" },
    { SUPABASE_DB_URL: env.SUPABASE_DB_URL!.replace("verify-full", "disable") },
    { SESSION_SECRET: undefined }, { MASTER_CATALOG_REVIEW_TOKEN_SECRET: undefined },
  ]) assert.throws(() => getApiDeliveryPhotoStorageProvider({ ...env, ...changes }));
  for (const name of [
    "R2_RUNTIME_APPROVAL", "R2_BUCKET_ACCESS", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "R2_OBJECT_PREFIX",
    "R2_PRIVATE_REFERENCE_ROOT", "R2_PUBLIC_REFERENCE_ROOT", "PRIVATE_OBJECT_DIR", "PUBLIC_OBJECT_SEARCH_PATHS",
  ]) assert.throws(() => getApiDeliveryPhotoStorageProvider({ ...env, [name]: undefined }), /unapproved/);
});

test("Vendor selector explicitly permits isolated documents without enabling global storage", () => {
  const env = vendorEnv();
  assert.equal(getApiVendorDocumentStorageProvider(env), "supabase-storage");
  assert.equal(getApiObjectStorageProvider(env), "disabled");
  assert.throws(() => assertStorageOperationsEnabled(env), /Storage is unavailable/);
  assert.equal(getApiAssetStorageProvider(env), undefined);
});

test("unset Vendor selector preserves defaults and does not require new configuration", () => {
  assert.equal(getApiVendorDocumentStorageProvider({}), undefined);
  assert.equal(getApiObjectStorageProvider({}), "replit-gcs-sidecar");
  const env = vendorEnv();
  delete env.API_VENDOR_DOCUMENT_STORAGE_PROVIDER;
  assert.equal(getApiVendorDocumentStorageProvider(env), undefined);
  assert.throws(() => assertStorageOperationsEnabled(env), /Storage is unavailable/);
});

test("Vendor selector rejects invalid values, shared overrides and R2 before target validation", () => {
  for (const value of ["", "disabled", "cloudflare-r2", "SUPABASE-STORAGE"]) {
    assert.throws(() => getApiVendorDocumentStorageProvider({
      API_VENDOR_DOCUMENT_STORAGE_PROVIDER: value,
    }), /API_VENDOR_DOCUMENT_STORAGE_PROVIDER/);
  }
  for (const conflicts of [
    { API_ASSET_STORAGE_PROVIDER: "supabase-storage" },
    { API_ASSET_STORAGE_PROVIDER: "" },
    { API_OBJECT_STORAGE_PROVIDER: "cloudflare-r2" },
  ]) {
    assert.throws(() => getApiVendorDocumentStorageProvider({
      API_VENDOR_DOCUMENT_STORAGE_PROVIDER: "supabase-storage", ...conflicts,
    }), /conflicts/);
  }
});

test("Vendor selection preserves full target, key, TLS, timeout and signing guards", () => {
  const env = vendorEnv();
  for (const changes of [
    { API_ONLY_TARGET_PROFILE: undefined }, { API_ONLY_TARGET_PROFILE: "unknown" },
    { API_ONLY_TARGET_PROFILE: "original-customer-apk" },
    { SUPABASE_URL: "https://gkwcolipeavxnuzqlamb.supabase.co" },
    { SUPABASE_ANON_KEY: "invalid" }, { SUPABASE_SERVICE_ROLE_KEY: "invalid" },
    { SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_ANON_KEY },
    { SUPABASE_DB_URL: env.SUPABASE_DB_URL!.replace("verify-full", "disable") },
    { SUPABASE_DB_URL: env.SUPABASE_DB_URL!.replace("connect_timeout=10", "connect_timeout=0") },
    { SUPABASE_DB_URL: env.SUPABASE_DB_URL! + "&host=other.invalid" },
    { SESSION_SECRET: undefined }, { MASTER_CATALOG_REVIEW_TOKEN_SECRET: "short" },
  ]) assert.throws(() => getApiVendorDocumentStorageProvider({ ...env, ...changes }), /API-only startup refused/);
});

test("Vendor selection requires bucket and both consistent, disjoint reference roots", () => {
  const env = vendorEnv();
  for (const name of [
    "SUPABASE_STORAGE_BUCKET", "SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT",
    "SUPABASE_STORAGE_PUBLIC_REFERENCE_ROOT", "PRIVATE_OBJECT_DIR", "PUBLIC_OBJECT_SEARCH_PATHS",
  ]) assert.throws(() => getApiVendorDocumentStorageProvider({ ...env, [name]: undefined }), /Invalid offline Supabase Storage/);
  assert.throws(() => getApiVendorDocumentStorageProvider({
    ...env, SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT: env.SUPABASE_STORAGE_PUBLIC_REFERENCE_ROOT,
  }), /Invalid offline Supabase Storage/);
});

test("App Storage is selected only by its explicit provider value", () => {
  const env = { API_OBJECT_STORAGE_PROVIDER: "replit-app-storage" };
  assert.equal(getApiObjectStorageProvider(env), "replit-app-storage");
  assert.equal(
    selectApiObjectStorage(env, { replitGcsSidecar: "sidecar", replitAppStorage: "sdk" }),
    "sdk",
  );
});

test("unknown or empty provider settings fail without falling back", () => {
  for (const value of ["", "gcs", "replit-storage"]) {
    assert.throws(
      () => getApiObjectStorageProvider({ API_OBJECT_STORAGE_PROVIDER: value }),
      /API_OBJECT_STORAGE_PROVIDER must be/,
    );
  }
});

test("Supabase prototype selection is explicit and cannot fall through to a legacy adapter", () => {
  const env = syntheticSupabaseEnv();
  assert.equal(getApiObjectStorageProvider(env), "supabase-storage");
  const legacy = { replitGcsSidecar: "sidecar", replitAppStorage: "sdk", externalGcs: "gcs" };
  assert.throws(() => selectApiObjectStorage(env, legacy), /Offline Supabase Storage adapter/);
  assert.equal(selectApiObjectStorage(env, { ...legacy, supabaseStorage: "offline" }), "offline");
  assert.throws(() => getApiObjectStorageProvider({ ...env, SUPABASE_STORAGE_BUCKET: undefined }),
    /Invalid offline Supabase Storage/);
});


test("asset storage remains on the existing provider when its setting is unset", () => {
  assert.equal(getApiAssetStorageProvider({}), undefined);
  assert.equal(getApiObjectStorageProvider({}), "replit-gcs-sidecar");
});

test("Supabase can be explicitly selected for asset storage without changing the global provider", () => {
  const env = {
    ...syntheticSupabaseEnv(),
    API_OBJECT_STORAGE_PROVIDER: "replit-gcs-sidecar",
    API_ASSET_STORAGE_PROVIDER: "supabase-storage",
  };
  assert.equal(getApiAssetStorageProvider(env), "supabase-storage");
  assert.equal(getApiObjectStorageProvider(env), "replit-gcs-sidecar");
});

test("unknown asset storage provider settings fail without fallback", () => {
  assert.throws(
    () => getApiAssetStorageProvider({ API_ASSET_STORAGE_PROVIDER: "replit-gcs-sidecar" }),
    /API_ASSET_STORAGE_PROVIDER must be/,
  );
});


test("disabled global storage blocks operations even when Supabase asset storage is configured", () => {
  const env = {
    ...syntheticSupabaseEnv(),
    API_OBJECT_STORAGE_PROVIDER: "disabled",
    API_ONLY_TARGET_PROFILE: "isolated-native-preview",
    API_ASSET_STORAGE_PROVIDER: "supabase-storage",
  };

  assert.equal(getApiObjectStorageProvider(env), "disabled");
  assert.equal(getApiAssetStorageProvider(env), "supabase-storage");
  assert.throws(
    () => assertStorageOperationsEnabled(env),
    new RegExp(STORAGE_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});
