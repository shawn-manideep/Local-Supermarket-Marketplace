import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createGcsObjectStore } from "./external-gcs.js";
import { FakeGcs } from "./fixtures/fake-gcs.js";

const checksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Deliberately no source/destination/env arguments: this cannot run a live copy. */
export async function runSyntheticRehearsal(fault?: "checksum" | "metadata") {
  const source = new FakeGcs(), destination = new FakeGcs();
  const categories = ["product-images", "application-branding", "vendor-documents", "delivery-photos"];
  for (const category of categories) {
    const privateFile = category === "vendor-documents" || category === "delivery-photos";
    source.seed(`synthetic/${privateFile ? "private" : "public"}/${category}/fixture`, Buffer.from(`synthetic-${category}`), {
      mimeType: category === "vendor-documents" ? "application/pdf" : "image/png",
      cacheControl: privateFile ? "private, no-store" : "no-store",
      custom: { visibility: privateFile ? "private" : "published-product", synthetic: "true" },
      contentDisposition: "inline",
      contentLanguage: "en",
    });
  }
  const before = structuredClone([...source.objects]);
  const from = createGcsObjectStore(source, "synthetic-source");
  const to = createGcsObjectStore(destination, "synthetic-destination");
  let checksumFailures = 0, metadataFailures = 0, verified = 0;
  for (const key of source.objects.keys()) {
    const object = await from.read(key);
    const { generation: _sourceGeneration, ...metadata } = object.metadata;
    await to.write(key, object.bytes, metadata, 0);
    if (fault && verified === 0) {
      const copied = destination.objects.get(key)!;
      if (fault === "checksum") copied.bytes = Buffer.from("synthetic-corruption");
      else copied.metadata.mimeType = "application/octet-stream";
    }
    const copied = await to.read(key);
    if (checksum(object.bytes) !== checksum(copied.bytes)) checksumFailures++;
    const { generation: _destinationGeneration, ...actualMetadata } = copied.metadata;
    if (!isDeepStrictEqual(metadata, actualMetadata)) metadataFailures++;
    verified++;
  }
  const sourceUnchanged = isDeepStrictEqual(before, structuredClone([...source.objects]));
  return {
    mode: "synthetic-only",
    categoriesVerified: categories,
    objectsVerified: verified,
    checksumAlgorithm: "SHA-256",
    checksumFailures,
    metadataFailures,
    sourceUnchanged,
    passed: checksumFailures === 0 && metadataFailures === 0 && sourceUnchanged,
  };
}
