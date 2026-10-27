import assert from "node:assert/strict";
import test from "node:test";
import { createGcsObjectStore } from "./external-gcs.js";
import { createExternalAssets } from "./external-assets.js";
import { externalGcsConfig } from "./external-gcs-config.js";
import { getApiObjectStorageProvider, selectApiObjectStorage } from "./provider.js";
import { ObjectStoreError } from "./object-store.js";
import { FakeGcs, syntheticExternalEnv } from "./fixtures/fake-gcs.js";
import { runSyntheticRehearsal } from "./synthetic-rehearsal.js";

function fixture() {
  const client = new FakeGcs();
  const store = createGcsObjectStore(client, "synthetic-destination");
  const config = externalGcsConfig(syntheticExternalEnv());
  return { client, store, assets: createExternalAssets(store, config) };
}
const png = Buffer.from("synthetic-png");
const meta = { mimeType: "image/png", cacheControl: "private, no-store", custom: { visibility: "private" } };

test("external activation requires every explicit setting and exact reference mapping", () => {
  const valid = syntheticExternalEnv();
  assert.equal(getApiObjectStorageProvider(valid), "external-gcs");
  assert.equal(selectApiObjectStorage(valid, {
    replitGcsSidecar: "sidecar", replitAppStorage: "sdk", externalGcs: "external",
  }), "external");
  for (const name of Object.keys(valid)) {
    if (name === "API_OBJECT_STORAGE_PROVIDER") continue;
    const incomplete = { ...valid };
    delete incomplete[name];
    assert.throws(() => getApiObjectStorageProvider(incomplete));
  }
  for (const override of [
    { EXTERNAL_GCS_RUNTIME_APPROVAL: "true" }, { EXTERNAL_GCS_BUCKET: "https://wrong.invalid" },
    { EXTERNAL_GCS_CLIENT_EMAIL: "wrong" }, { EXTERNAL_GCS_PRIVATE_KEY: "bad" },
    { PRIVATE_OBJECT_DIR: "/different/private" }, { PUBLIC_OBJECT_SEARCH_PATHS: "a,b" },
    { EXTERNAL_GCS_PUBLIC_REFERENCE_ROOT: "/synthetic-source/private", PUBLIC_OBJECT_SEARCH_PATHS: "/synthetic-source/private" },
    { STORAGE_EMULATOR_HOST: "http://127.0.0.1:9000" },
  ]) assert.throws(() => externalGcsConfig({ ...valid, ...override }));
  // Irrelevant/incomplete external settings must not activate or alter defaults.
  assert.equal(getApiObjectStorageProvider({ EXTERNAL_GCS_BUCKET: "incomplete" }), "replit-gcs-sidecar");
  assert.equal(getApiObjectStorageProvider({ API_OBJECT_STORAGE_PROVIDER: "replit-app-storage", EXTERNAL_GCS_BUCKET: "incomplete" }), "replit-app-storage");
  assert.throws(() => selectApiObjectStorage(valid, { replitGcsSidecar: 1, replitAppStorage: 2 }));
});

test("legacy references map to deterministic keys without rewriting identifiers or selecting source buckets", async () => {
  const { client, assets } = fixture();
  await assets.products.put("store-a", "image-a", png, "image/webp");
  await assets.documents.put("/synthetic-source/private/vendor-documents/store-a/doc-a", png, "application/pdf");
  await assets.photos.put("/synthetic-source/private/delivery-photos/assignment-a/photo-a", png, "image/png");
  assert.deepEqual([...client.objects.keys()], [
    "synthetic-source/public/product-images/store-a/image-a",
    "synthetic-source/private/vendor-documents/store-a/doc-a",
    "synthetic-source/private/delivery-photos/assignment-a/photo-a",
  ]);
  assert.equal((await assets.products.get("store-a", "image-a")).mimeType, "image/webp");
  assert.deepEqual(await assets.documents.get("/synthetic-source/private/vendor-documents/store-a/doc-a"), png);
  assert.equal(client.objects.get("synthetic-source/private/vendor-documents/store-a/doc-a")?.metadata.cacheControl, "private, no-store");
  assert.equal(client.objects.get("synthetic-source/public/product-images/store-a/image-a")?.metadata.custom.visibility, "published-product");
  for (const ref of [
    "/other/private/vendor-documents/store-a/doc-a",
    "/synthetic-source/private/delivery-photos/store-a/doc-a",
    "/synthetic-source/private/vendor-documents/store-a/../doc-a",
    "/synthetic-source/private/vendor-documents/store-a/%2e%2e",
    "/synthetic-source/private/vendor-documents/store-a\\doc-a",
    "/synthetic-source/private/vendor-documents/store-a/doc-a/extra",
  ]) await assert.rejects(assets.documents.get(ref));
  await assert.rejects(assets.products.get("store-a/other", "image-a"));
});

test("new objects are create-only; MIME/custom metadata survive; reads pin their generation", async () => {
  const { store, client } = fixture();
  const fullMetadata = { ...meta, custom: { ...meta.custom, preserved: true, count: 7 },
    contentDisposition: "inline", contentEncoding: "identity", contentLanguage: "en" };
  await store.write("fixture/image", png, fullMetadata, 0);
  const { generation: _generation, ...actual } = (await store.read("fixture/image")).metadata;
  assert.deepEqual(actual, fullMetadata);
  await assert.rejects(store.write("fixture/image", Buffer.from("other"), meta, 0),
    (error: unknown) => error instanceof ObjectStoreError && error.code === "conflict");
  client.beforeDownload = () => client.seed("fixture/image", Buffer.from("newer"), { ...meta, mimeType: "image/jpeg" });
  const pinned = await store.read("fixture/image");
  assert.deepEqual(pinned.bytes, png);
  assert.equal(pinned.metadata.mimeType, "image/png");
  assert.equal(pinned.metadata.generation, "1");
  assert.equal(client.operations.filter(op => op.operation === "read").at(-1)?.generation, "1");
  await assert.rejects(store.remove("fixture/image", "1"),
    (error: unknown) => error instanceof ObjectStoreError && error.code === "conflict");
});

test("branding revisions and conditional replacements preserve concurrent or failed uploads", async () => {
  const { client, assets } = fixture();
  assert.equal(await assets.branding.metadata(), null);
  await assets.branding.put(png, "image/png");
  const first = await assets.branding.metadata();
  await assets.branding.put(Buffer.from("second"), "image/jpeg");
  assert.notEqual((await assets.branding.metadata())?.revision, first?.revision);
  const key = "synthetic-source/public/application-branding/active-logo";
  client.beforeSave = () => client.seed(key, Buffer.from("concurrent"), meta);
  await assert.rejects(assets.branding.put(Buffer.from("stale"), "image/png"),
    (error: unknown) => error instanceof ObjectStoreError && error.code === "conflict");
  assert.equal((await assets.branding.get()).bytes.toString(), "concurrent");
  client.failure = { operation: "write", code: 503, message: "sensitive upstream detail" };
  await assert.rejects(assets.branding.put(png, "image/png"), /unavailable/);
  assert.equal((await assets.branding.get()).bytes.toString(), "concurrent");
  await assert.rejects(assets.branding.put(png, "text/html"));
});

test("missing objects, provider failures and conditional deletion fail safely without credential leakage", async () => {
  const { client, assets, store } = fixture();
  await assert.rejects(assets.products.get("store-a", "absent"),
    (error: unknown) => error instanceof ObjectStoreError && error.code === "not-found");
  for (const operation of ["head", "read", "write", "delete"]) {
    client.seed("fixture/image", png, meta);
    client.failure = { operation, code: 403, message: "PRIVATE-DETAIL-MUST-NOT-LEAK" };
    const call = operation === "head" ? () => store.head("fixture/image")
      : operation === "read" ? () => store.read("fixture/image")
      : operation === "write" ? () => store.write("fixture/new", png, meta, 0)
      : () => store.remove("fixture/image", client.objects.get("fixture/image")!.generation);
    await assert.rejects(call(), error => {
      assert.ok(error instanceof ObjectStoreError);
      assert.equal(error.message.includes("PRIVATE-DETAIL"), false);
      return true;
    });
  }
  await assets.products.put("store-a", "image-a", png, "image/png");
  await assets.products.discard("store-a", "image-a");
  await assets.products.discard("store-a", "image-a");
  assert.equal(client.objects.has("synthetic-source/public/product-images/store-a/image-a"), false);
});

test("synthetic rehearsal verifies four asset classes, checksums, metadata and an unchanged source", async () => {
  const report = await runSyntheticRehearsal();
  assert.equal(report.passed, true);
  assert.equal(report.objectsVerified, 4);
  assert.equal(report.sourceUnchanged, true);
  assert.equal((await runSyntheticRehearsal("checksum")).checksumFailures, 1);
  assert.equal((await runSyntheticRehearsal("metadata")).metadataFailures, 1);
  const serialized = JSON.stringify(report);
  for (const forbidden of ["privateKey", "clientEmail", "synthetic-source", "bytes", "object_ref"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
