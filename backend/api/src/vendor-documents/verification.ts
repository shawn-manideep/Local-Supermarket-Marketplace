import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { HttpError } from "../http.js";
import { DOCUMENT_TYPES } from "./files.js";
import { documentStatus } from "./service.js";

export const MANDATORY_DOCUMENT_TYPES = DOCUMENT_TYPES.filter(d => d.mandatory).map(d => d.type);
const fail = (message: string) => { throw new HttpError(409, message, undefined, "DOCUMENT_VERIFICATION_CONFLICT"); };

export async function submitDocuments(storeId: string) {
  await getDb().transaction(async tx => {
    const result = await tx.execute(sql`SELECT documents_required,document_verification_status FROM stores WHERE id=${storeId} FOR UPDATE`);
    const store = result.rows[0];
    if (!store) throw new HttpError(404, "Vendor store not found");
    if (!store.documents_required) fail("This existing account retains catalog access without the new verification gate.");
    if (["SUBMITTED", "APPROVED"].includes(String(store.document_verification_status)))
      fail("This submission is already pending review or approved.");
    const documents = await tx.execute(sql`SELECT id,document_type FROM vendor_documents
      WHERE store_id=${storeId} AND is_current AND document_type IN ('fssai','aadhaar','pan','photo') FOR UPDATE`);
    if (documents.rows.length !== 4) fail("Upload all four mandatory documents before submitting.");
    const submissionId = randomUUID();
    await tx.execute(sql`UPDATE vendor_documents SET verification_status='SUBMITTED',
      submission_id=${submissionId},rejection_reason=NULL,updated_at=now()
      WHERE store_id=${storeId} AND is_current AND document_type IN ('fssai','aadhaar','pan','photo')`);
    await tx.execute(sql`UPDATE stores SET document_verification_status='SUBMITTED',
      document_submission_id=${submissionId},documents_submitted_at=now(),
      documents_reviewed_at=NULL,documents_reviewed_by=NULL,document_rejection_reason=NULL WHERE id=${storeId}`);
  });
  return documentStatus(storeId);
}

export async function reviewDocuments(
  storeId: string, actorId: string, submissionId: string,
  rejection?: { reason: string; rejectedTypes: string[] },
) {
  await getDb().transaction(async tx => {
    const result = await tx.execute(sql`SELECT document_verification_status,document_submission_id
      FROM stores WHERE id=${storeId} FOR UPDATE`);
    const store = result.rows[0];
    if (!store || store.document_verification_status !== "SUBMITTED" || store.document_submission_id !== submissionId)
      fail("This submission changed or is no longer pending review. Refresh before reviewing.");
    const documents = await tx.execute(sql`SELECT id FROM vendor_documents WHERE store_id=${storeId}
      AND is_current AND document_type IN ('fssai','aadhaar','pan','photo')
      AND submission_id=${submissionId} AND verification_status='SUBMITTED' FOR UPDATE`);
    if (documents.rows.length !== 4) fail("The current mandatory documents do not match this submission.");
    await tx.execute(sql`UPDATE vendor_documents SET verification_status='APPROVED',rejection_reason=NULL,updated_at=now()
      WHERE store_id=${storeId} AND is_current AND submission_id=${submissionId}
      AND document_type IN ('fssai','aadhaar','pan','photo')`);
    if (rejection) {
      for (const type of rejection.rejectedTypes) await tx.execute(sql`UPDATE vendor_documents
        SET verification_status='REJECTED',rejection_reason=${rejection.reason},updated_at=now()
        WHERE store_id=${storeId} AND is_current AND document_type=${type} AND submission_id=${submissionId}`);
    }
    await tx.execute(sql`UPDATE stores SET document_verification_status=${rejection ? "REJECTED" : "APPROVED"},
      documents_reviewed_at=now(),documents_reviewed_by=${actorId},
      document_rejection_reason=${rejection?.reason ?? null} WHERE id=${storeId}`);
  });
  return documentStatus(storeId);
}
