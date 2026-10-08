import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { requireRole } from "../auth/index.js";
import { asyncHandler, HttpError } from "../http.js";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, validateDocument } from "./files.js";
import { documentStorage } from "./storage.js";
import { adminDocumentStore, documentStatus, ownedDocumentStore } from "./service.js";
import { sendDocumentContent } from "./content.js";

export const vendorDocumentsRouter = Router();
vendorDocumentsRouter.get("/api/vendor/documents", requireRole("vendor"), asyncHandler(async (request, response) => {
  response.setHeader("Cache-Control", "private, no-store");
  response.json(await documentStatus(ownedDocumentStore(request)));
}));
vendorDocumentsRouter.put("/api/vendor/documents/:type", requireRole("vendor"),
  express.raw({ type: ["application/pdf", "image/jpeg", "image/png"], limit: MAX_DOCUMENT_BYTES }),
  asyncHandler(async (request, response) => {
    const storeId = ownedDocumentStore(request);
    const type = String(request.params.type);
    if (!DOCUMENT_TYPES.some(item => item.type === type)) throw new HttpError(400, "Invalid document type");
    const fileName = typeof request.query.fileName === "string" ? request.query.fileName : "";
    const mimeType = request.get("content-type")?.split(";")[0] ?? "";
    const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    validateDocument(fileName, mimeType, bytes);
    const directory = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "");
    if (!directory) throw new HttpError(503, "Private document storage is unavailable");
    const id = randomUUID();
    const ref = `${directory}/vendor-documents/${storeId}/${id}`;
    await documentStorage.put(ref, bytes, mimeType);
    try {
      await getDb().transaction(async transaction => {
        // Serialize replacement/version assignment per store. A failed upload
        // never replaces the current valid document.
        await transaction.execute(sql`SELECT id FROM stores WHERE id=${storeId} FOR UPDATE`);
        const previous = await transaction.execute(sql`SELECT coalesce(max(version),0)::integer AS version
          FROM vendor_documents WHERE store_id=${storeId} AND document_type=${type}`);
        const version = Number(previous.rows[0]?.version ?? 0) + 1;
        await transaction.execute(sql`UPDATE vendor_documents SET is_current=false,updated_at=now()
          WHERE store_id=${storeId} AND document_type=${type} AND is_current`);
        await transaction.execute(sql`INSERT INTO vendor_documents
          (id,store_id,document_type,object_ref,file_name,mime_type,size_bytes,version)
          VALUES (${id},${storeId},${type},${ref},${fileName},${mimeType},${bytes.length},${version})`);
      });
    } catch (error) {
      await documentStorage.discard(ref).catch(() => undefined);
      throw error;
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.status(201).json(await documentStatus(storeId));
  }));
vendorDocumentsRouter.get("/api/vendor/documents/:id/content", requireRole("vendor"), asyncHandler(async (request, response) => {
  await sendDocumentContent(ownedDocumentStore(request), String(request.params.id), response);
}));
vendorDocumentsRouter.get("/api/admin/vendors/:vendorId/documents", requireRole("admin"), asyncHandler(async (request, response) => {
  const storeId = await adminDocumentStore(String(request.params.vendorId));
  response.setHeader("Cache-Control", "private, no-store");
  response.json(await documentStatus(storeId));
}));
vendorDocumentsRouter.get("/api/admin/vendors/:vendorId/documents/:id/content", requireRole("admin"), asyncHandler(async (request, response) => {
  const storeId = await adminDocumentStore(String(request.params.vendorId));
  await sendDocumentContent(storeId, String(request.params.id), response);
}));
