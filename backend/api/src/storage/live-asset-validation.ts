import { SupabaseStorageError, validateBytes } from "./supabase-storage.js";

export function validateLiveAssetBytes(bytes: unknown, mimeType: unknown): asserts bytes is Buffer {
  validateBytes(bytes, mimeType);

  const valid = mimeType === "application/pdf"
    ? bytes.subarray(0, 5).toString() === "%PDF-" &&
      bytes.subarray(-1024).includes(Buffer.from("%%EOF"))
    : mimeType === "image/jpeg"
      ? bytes.length > 16 &&
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
        bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
      : mimeType === "image/png"
        ? bytes.length >= 45 &&
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          bytes.toString("ascii", 12, 16) === "IHDR" &&
          bytes.readUInt32BE(16) > 0 &&
          bytes.readUInt32BE(20) > 0 &&
          bytes.toString("ascii", bytes.length - 8, bytes.length - 4) === "IEND"
        : mimeType === "image/webp"
          ? bytes.length >= 20 &&
            bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.readUInt32LE(4) + 8 === bytes.length &&
            bytes.toString("ascii", 8, 12) === "WEBP" &&
            ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16))
          : false;

  if (!valid) throw new SupabaseStorageError("INVALID_INPUT");
}
