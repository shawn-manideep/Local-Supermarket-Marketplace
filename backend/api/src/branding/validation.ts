import { HttpError } from "../http.js";
import { validateProductImage } from "../product-images/validation.js";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export function validateLogo(name: string, mimeType: string, bytes: Buffer) {
  if (!["image/png", "image/jpeg"].includes(mimeType)) throw new HttpError(400, "Choose a PNG or JPEG logo. SVG is not supported.");
  if (bytes.length > MAX_LOGO_BYTES) throw new HttpError(413, "Logo must be at most 2 MiB.");
  validateProductImage(name, mimeType, bytes);
}
