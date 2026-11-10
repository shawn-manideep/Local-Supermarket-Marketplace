import assert from "node:assert/strict";
import test from "node:test";
import { syntheticSupabaseEnv } from "./fixtures/fake-supabase-storage.js";
import {
  getApiObjectStorageProvider,
  getApiAssetStorageProvider,
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
