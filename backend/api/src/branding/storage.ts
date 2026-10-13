import { Storage } from "@google-cloud/storage";

// Reuse the existing App Storage bucket, without touching product/document keys.
const storage = new Storage({
  projectId: "",
  credentials: {
    type: "external_account", audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
});
function file() {
  const directory = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.split(",").map(value => value.trim().replace(/\/$/, "")).find(Boolean);
  if (!directory) throw new Error("Application branding storage is not configured");
  const parts = directory.replace(/^\//, "").split("/");
  return storage.bucket(parts.shift()!).file([...parts, "application-branding", "active-logo"].join("/"));
}
export const brandingStorage = {
  async metadata() {
    try {
      const [metadata] = await file().getMetadata();
      return { revision: String(metadata.generation), mimeType: metadata.contentType ?? "application/octet-stream" };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 404) return null;
      throw error;
    }
  },
  async put(bytes: Buffer, mimeType: string) {
    // A single object replacement is atomic; a failed upload leaves the old logo.
    await file().save(bytes, { resumable: false, validation: "crc32c",
      metadata: { contentType: mimeType, cacheControl: "no-store" } });
  },
  async get() {
    const object = file();
    const [metadata] = await object.getMetadata();
    const [bytes] = await object.bucket.file(object.name, { generation: metadata.generation }).download();
    return { bytes, mimeType: metadata.contentType ?? "application/octet-stream" };
  },
};
