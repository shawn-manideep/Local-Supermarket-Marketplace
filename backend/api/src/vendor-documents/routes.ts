import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedRequest } from "../auth/types.js";
import { MANDATORY_DOCUMENT_TYPES, reviewDocuments, submitDocuments } from "./verification.js";
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
        const state = await transaction.execute(sql`SELECT id,documents_required,document_verification_status FROM stores WHERE id=${storeId} FOR UPDATE`);
        const mandatory = DOCUMENT_TYPES.some(d => d.type === type && d.mandatory);
        if (mandatory && state.rows[0]?.document_verification_status === "SUBMITTED")
          throw new HttpError(409, "Submitted documents are locked while Admin reviews them.", undefined, "DOCUMENTS_PENDING_REVIEW");
        if (mandatory && state.rows[0]?.documents_required) {
          await transaction.execute(sql`INSERT INTO platform_management_events(actor_user_id,action,target_type,target_id,previous_status,next_status,details)
            VALUES(${(request as AuthenticatedRequest).auth!.userId},'mandatory_document_replaced','store',${storeId},
              ${state.rows[0].document_verification_status},'DRAFT',${JSON.stringify({type,documentId:id})}::jsonb)`);
          await transaction.execute(sql`UPDATE stores SET document_verification_status='DRAFT',
            document_submission_id=NULL,documents_submitted_at=NULL,documents_reviewed_at=NULL,
            documents_reviewed_by=NULL WHERE id=${storeId}`);
        }
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
vendorDocumentsRouter.post("/api/vendor/documents/submit", requireRole("vendor"), asyncHandler(async (request, response) => {
  const parsed = z.object({}).strict().safeParse(request.body ?? {});
  if (!parsed.success) throw new HttpError(400, "Invalid submission request");
  response.setHeader("Cache-Control", "private, no-store");
  response.json(await submitDocuments(ownedDocumentStore(request)));
}));
const reviewInput = z.object({ submissionId: z.string().uuid() }).strict();
const rejectionInput = z.object({
  submissionId: z.string().uuid(), reason: z.string().trim().min(1).max(1000),
  rejectedTypes: z.array(z.string().refine(t => MANDATORY_DOCUMENT_TYPES.some(m => m === t))).min(1).max(4),
}).strict();
for (const action of ["approve", "reject"] as const) {
  vendorDocumentsRouter.post(`/api/admin/vendors/:vendorId/documents/${action}`, requireRole("admin"),
    asyncHandler(async (request, response) => {
      const parsed = (action === "reject" ? rejectionInput : reviewInput).safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, "Provide the current submission and a rejection reason/document selection when rejecting.");
      const storeId = await adminDocumentStore(String(request.params.vendorId));
      const rejection = action === "reject"
        ? rejectionInput.parse(request.body) : undefined;
      response.setHeader("Cache-Control", "private, no-store");
      response.json(await reviewDocuments(storeId, (request as AuthenticatedRequest).auth!.userId,
        parsed.data.submissionId, rejection));
    }));
}
vendorDocumentsRouter.get("/api/admin/vendors/:vendorId/documents", requireRole("admin"), asyncHandler(async (request, response) => {
  const storeId = await adminDocumentStore(String(request.params.vendorId));
  response.setHeader("Cache-Control", "private, no-store");
  response.json(await documentStatus(storeId));
}));
vendorDocumentsRouter.get("/api/admin/vendors/:vendorId/documents/:id/content", requireRole("admin"), asyncHandler(async (request, response) => {
  const storeId = await adminDocumentStore(String(request.params.vendorId));
  await sendDocumentContent(storeId, String(request.params.id), response);
}));
