import { HttpError } from "../http.js";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_TYPES = [
  { type: "fssai", label: "FSSAI License", mandatory: true },
  { type: "aadhaar", label: "Aadhaar Card", mandatory: true },
  { type: "pan", label: "PAN Card", mandatory: true },
  { type: "photo", label: "Photo", mandatory: true },
  { type: "gst", label: "GST", mandatory: false },
  { type: "trade_license", label: "Trade License", mandatory: false },
  { type: "labour_license", label: "Labour License", mandatory: false },
] as const;

export function validateDocument(fileName: string, mimeType: string, bytes: Buffer) {
  if (!fileName || fileName.length > 200 || /[\/\\\x00-\x1f\x7f]/.test(fileName)) {
    throw new HttpError(400, "Invalid document filename");
  }
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new HttpError(400, "Document must be non-empty and no larger than 5 MB");
  }
  const extension = fileName.split(".").pop()?.toLowerCase();
  const allowed = mimeType === "application/pdf" ? ["pdf"]
    : mimeType === "image/jpeg" ? ["jpg", "jpeg"]
      : mimeType === "image/png" ? ["png"] : [];
  if (!allowed.includes(extension ?? "")) throw new HttpError(400, "Upload a PDF, JPG, JPEG, or PNG with a matching file type");
  const valid = mimeType === "application/pdf"
    ? bytes.subarray(0, 5).toString() === "%PDF-" && bytes.subarray(-1024).includes(Buffer.from("%%EOF"))
    : mimeType === "image/jpeg"
      ? bytes.length > 16 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
        bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
      : bytes.length > 44 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
        bytes.subarray(12,16).toString() === "IHDR" && bytes.readUInt32BE(16) > 0 &&
        bytes.readUInt32BE(20) > 0 && bytes.subarray(-8,-4).toString() === "IEND";
  if (!valid) throw new HttpError(400, "Document is invalid or corrupt");
}
