import { HttpError } from "../http.js";
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export function validateProductImage(name: string, mimeType: string, bytes: Buffer) {
  if (!name || name.length > 200 || /[\\/\x00-\x1f\x7f]/.test(name)) throw new HttpError(400, "Invalid image filename");
  const types: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  if (types[name.split(".").pop()?.toLowerCase() ?? ""] !== mimeType) throw new HttpError(400, "Choose a JPG/JPEG, PNG or WebP image with a matching file type");
  if (!bytes.length) throw new HttpError(400, "Image is empty");
  if (bytes.length > MAX_PRODUCT_IMAGE_BYTES) throw new HttpError(413, "Image must be at most 5 MiB");
  const jpeg = bytes.length > 16 && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) && bytes.subarray(-2).equals(Buffer.from([255, 217]));
  const png = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
    bytes.toString("ascii",12,16) === "IHDR" && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 &&
    bytes.toString("ascii",bytes.length-8,bytes.length-4) === "IEND";
  const webp = bytes.length >= 20 && bytes.toString("ascii",0,4) === "RIFF" &&
    bytes.readUInt32LE(4) + 8 === bytes.length && bytes.toString("ascii",8,12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii",12,16));
  if (!(mimeType === "image/jpeg" ? jpeg : mimeType === "image/png" ? png : webp)) throw new HttpError(400, "Image content is invalid or does not match its file type");
}
export function assertOwnProductImage(value: string | null | undefined, storeId: string) {
  if (!value) return;
  let path = value;
  try { path = new URL(value).pathname; } catch { /* Managed references are root-relative. */ }
  if (!path.startsWith("/api/product-images/")) return;
  const match = /^\/api\/product-images\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i.exec(path);
  if (!match || match[1] !== storeId) throw new HttpError(403, "Uploaded image does not belong to your store");
}
