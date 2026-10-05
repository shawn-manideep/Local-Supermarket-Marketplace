import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { HttpError } from "../http.js";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_CATALOG_ROWS = 10_000;
export const PREVIEW_TTL_MS = 10 * 60 * 1000;

export function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function sign(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new HttpError(503, "Catalog workbook signing is not configured");
  return createHmac("sha256", secret).update(`catalog-excel-v1:${value}`).digest("base64url");
}

export function identityProof(sheet: string, id: string, revision: string) {
  return sign(JSON.stringify({ sheet, id, revision }));
}

export function revisionProof(revision: string) {
  return sign(`revision:${revision}`);
}

export function equalProof(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

type PreviewClaims = {
  actor: string;
  revision: string;
  workbookHash: string;
  expires: number;
};

export function createPreviewToken(actor: string, revision: string, bytes: Buffer, now = Date.now()) {
  const claims: PreviewClaims = { actor, revision, workbookHash: digest(bytes), expires: now + PREVIEW_TTL_MS };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(claims.expires).toISOString() };
}

export function verifyPreviewToken(token: string, actor: string, bytes: Buffer, now = Date.now()) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || token.length > 4096 || !equalProof(sign(payload), signature)) {
    throw new HttpError(400, "Invalid catalog preview. Upload and validate the workbook again.");
  }
  let claims: PreviewClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PreviewClaims;
  } catch {
    throw new HttpError(400, "Invalid catalog preview");
  }
  if (claims.actor !== actor || !Number.isFinite(claims.expires) || claims.expires <= now) {
    throw new HttpError(400, "This preview expired or belongs to another Admin. Validate again.");
  }
  if (claims.workbookHash !== digest(bytes) || typeof claims.revision !== "string") {
    throw new HttpError(409, "The workbook changed after validation. Upload and preview it again.");
  }
  return claims;
}

// Bounded ZIP inspection before ExcelJS allocates/parses XML. Central directory
// limits alone are insufficient: verify the actual inflated sizes as well.
export function inspectXlsxArchive(bytes: Buffer) {
  if (bytes.length < 22 || bytes.length > MAX_UPLOAD_BYTES || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new HttpError(400, "Upload a valid .xlsx workbook (maximum 2 MiB)");
  }
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new HttpError(400, "Invalid workbook ZIP directory");
  const entries = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) ||
      bytes.readUInt16LE(end + 8) !== entries || entries > 200 || entries === 0 ||
      start + size !== end) throw new HttpError(400, "Unsupported workbook archive structure");
  let offset = start;
  let total = 0;
  const names = new Set<string>();
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new HttpError(400, "Invalid workbook entry");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const expanded = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end || local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50) throw new HttpError(400, "Invalid workbook bounds");
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (names.has(name) || name.includes("..") || name.includes("\\") || name.startsWith("/") ||
        /vba|macro|activex|embeddings|externallinks|\.bin$|connections\.xml|querytables/i.test(name) ||
        flags & 1 || ![0, 8].includes(method)) {
      throw new HttpError(400, "Macros, external data, encrypted files, and ambiguous archive entries are not supported");
    }
    names.add(name);
    total += expanded;
    if (expanded > 8 * 1024 * 1024 || total > 20 * 1024 * 1024) throw new HttpError(413, "Expanded workbook exceeds safety limits");
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (dataStart + compressed > start ||
        bytes.subarray(local + 30, local + 30 + bytes.readUInt16LE(local + 26)).toString("utf8") !== name ||
        bytes.readUInt16LE(local + 8) !== method) throw new HttpError(400, "Ambiguous workbook entry");
    try {
      const contents = bytes.subarray(dataStart, dataStart + compressed);
      const decoded = method === 8 ? inflateRawSync(contents, { maxOutputLength: Math.max(1, expanded) }) : contents;
      if (decoded.length !== expanded) throw new Error("Size mismatch");
      if (name.endsWith(".xml") || name.endsWith(".rels")) {
        const xml = decoded.toString("utf8");
        if (/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|TargetMode\s*=\s*["']External/i.test(xml)) {
          throw new HttpError(400, "External relationships, macros, and XML entities are not supported");
        }
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "Workbook entry failed bounded decompression");
    }
    offset = next;
  }
  if (offset !== end || !names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) {
    throw new HttpError(400, "This file is not an Excel .xlsx workbook");
  }
}
