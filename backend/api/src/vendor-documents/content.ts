import type { Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { HttpError } from "../http.js";
import { documentStorage } from "./storage.js";

/** Shared, current-only private byte reader. Callers must authorize and resolve the store first. */
export async function sendDocumentContent(storeId: string, id: string, response: Response) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new HttpError(404, "Document not found");
  const result = await getDb().execute(sql`SELECT object_ref,mime_type,file_name FROM vendor_documents
    WHERE id=${id} AND store_id=${storeId} AND is_current`);
  const document = result.rows[0];
  if (!document) throw new HttpError(404, "Document not found");
  const bytes = await documentStorage.get(String(document.object_ref));
  response.setHeader("Content-Type", String(document.mime_type));
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "sandbox");
  response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(String(document.file_name))}`);
  response.send(bytes);
}
