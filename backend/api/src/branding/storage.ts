import { Storage } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import { getApiObjectStorageProvider } from "../storage/provider.js";
import {
  createBrandingStorageAdapter,
  getReplitObjectStore,
} from "../storage/replit-object-storage.js";

// Reuse the existing App Storage bucket, without touching product/document keys.
const storage = getApiObjectStorageProvider() === "replit-gcs-sidecar" ? new Storage({
  projectId: "",
  credentials: {
    type: "external_account", audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
}) : undefined;
function file() {
  const directory = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.split(",").map(value => value.trim().replace(/\/$/, "")).find(Boolean);
  if (!directory) throw new Error("Application branding storage is not configured");
  const parts = directory.replace(/^\//, "").split("/");
  if (!storage) throw new Error("The Replit GCS sidecar provider is not active.");
  return storage.bucket(parts.shift()!).file([...parts, "application-branding", "active-logo"].join("/"));
}
async function appStorage() {
  return createBrandingStorageAdapter(
    await getReplitObjectStore(),
    () => process.env.PUBLIC_OBJECT_SEARCH_PATHS,
    randomUUID,
  );
}
export const brandingStorage = {
  async metadata() {
    if (getApiObjectStorageProvider() === "replit-app-storage") {
      return (await appStorage()).metadata();
    }
    try {
      const [metadata] = await file().getMetadata();
      return { revision: String(metadata.generation), mimeType: metadata.contentType ?? "application/octet-stream" };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 404) return null;
      throw error;
    }
  },
  async put(bytes: Buffer, mimeType: string) {
    if (getApiObjectStorageProvider() === "replit-app-storage") {
      await (await appStorage()).put(bytes, mimeType);
      return;
    }
    // A single object replacement is atomic; a failed upload leaves the old logo.
    await file().save(bytes, { resumable: false, validation: "crc32c",
      metadata: { contentType: mimeType, cacheControl: "no-store" } });
  },
  async get() {
    if (getApiObjectStorageProvider() === "replit-app-storage") {
      return (await appStorage()).get();
    }
    const object = file();
    const [metadata] = await object.getMetadata();
    const [bytes] = await object.bucket.file(object.name, { generation: metadata.generation }).download();
    return { bytes, mimeType: metadata.contentType ?? "application/octet-stream" };
  },
};
