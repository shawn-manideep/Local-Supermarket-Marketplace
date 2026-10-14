import { Storage } from "@google-cloud/storage";

// Replit sidecar credentials: no user secrets or public storage endpoints.
const storage = new Storage({
  projectId: "",
  credentials: {
    type: "external_account", audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
});
function file(ref: string, area: "vendor-documents" | "delivery-photos") {
  const directory = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "");
  if (!directory || !ref.startsWith(`${directory}/${area}/`)) throw new Error("Invalid private object reference");
  const parts = ref.replace(/^\//, "").split("/");
  return storage.bucket(parts.shift()!).file(parts.join("/"));
}
export const privateObjectStorage = (area: "vendor-documents" | "delivery-photos") => ({
  async put(ref: string, bytes: Buffer, mimeType: string) {
    await file(ref, area).save(bytes, { resumable: false, validation: "crc32c",
      metadata: { contentType: mimeType, cacheControl: "private, no-store",
        metadata: { visibility: "private" } } });
  },
  async get(ref: string) { return (await file(ref, area).download())[0]; },
  async discard(ref: string) { await file(ref, area).delete({ ignoreNotFound: true }); },
});
export const documentStorage = privateObjectStorage("vendor-documents");
