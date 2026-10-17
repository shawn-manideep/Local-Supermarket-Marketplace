import assert from "node:assert/strict";
import test from "node:test";
import {
  getApiObjectStorageProvider,
  selectApiObjectStorage,
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
