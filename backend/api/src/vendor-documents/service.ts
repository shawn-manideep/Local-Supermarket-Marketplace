import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import type { Request } from "express";
import type { AuthenticatedRequest } from "../auth/types.js";
import { HttpError, asyncHandler } from "../http.js";
import { DOCUMENT_TYPES } from "./files.js";

export function ownedDocumentStore(request: Request) {
  const storeId = (request as AuthenticatedRequest).auth?.storeId;
  if (!storeId) throw new HttpError(404, "Vendor store not found");
  return storeId;
}
export async function documentStatus(storeId: string) {
  const storeRows = await getDb().execute(sql`SELECT documents_required AS required,
    document_verification_status AS "verificationStatus",document_submission_id AS "submissionId",
    documents_submitted_at AS "submittedAt",documents_reviewed_at AS "reviewedAt",
    document_rejection_reason AS "rejectionReason" FROM stores WHERE id=${storeId}`);
  const store = storeRows.rows[0];
  if (!store) throw new HttpError(404, "Vendor store not found");
  const result = await getDb().execute(sql`
    SELECT id,document_type AS type,file_name AS "fileName",mime_type AS "mimeType",
      size_bytes AS "sizeBytes",uploaded_at AS "uploadedAt",updated_at AS "updatedAt",version,
      verification_status AS "verificationStatus",rejection_reason AS "rejectionReason"
    FROM vendor_documents WHERE store_id=${storeId} AND is_current ORDER BY document_type`);
  const documents = DOCUMENT_TYPES.map(type => ({
    ...type, current: result.rows.find(row => row.type === type.type) ?? null,
  }));
  const mandatoryCount = documents.filter(item => item.mandatory && item.current).length;
  const optionalCount = documents.filter(item => !item.mandatory && item.current).length;
  const verified = mandatoryCount === 4 && store.verificationStatus === "APPROVED" &&
    documents.filter(d => d.mandatory).every(d => d.current?.verificationStatus === "APPROVED");
  const verificationStatus = store.required ? store.verificationStatus : "EXEMPT";
  const message = !store.required ? "Existing catalog access is retained; document verification is not required for this account."
    : verified ? "Documents approved. Your catalog is available."
    : verificationStatus === "SUBMITTED" ? "Documents submitted for verification. Catalog access will be enabled after approval."
    : verificationStatus === "REJECTED" ? "Documents rejected. Correct the rejected documents and resubmit for verification."
    : mandatoryCount === 4 ? "Documents uploaded. Submit them for Admin verification."
    : "Upload all mandatory documents, submit for verification and await Admin approval.";
  return { required: Boolean(store.required), mandatoryCount, optionalCount,
    canManageCatalog: !store.required || verified, verificationStatus,
    submissionId: store.submissionId, submittedAt: store.submittedAt,
    reviewedAt: store.reviewedAt, rejectionReason: store.rejectionReason, message,
    documents };
}
/** Admin selectors use the Vendor account ID, never a caller-supplied store ID. */
export async function adminDocumentStore(vendorId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vendorId))
    throw new HttpError(404, "Vendor store not found");
  const result = await getDb().execute(sql`SELECT s.id FROM stores s
    JOIN user_profiles p ON p.id=s.owner_user_id
    WHERE p.id=${vendorId} AND p.role='vendor'`);
  if (!result.rows[0]) throw new HttpError(404, "Vendor store not found");
  return String(result.rows[0].id);
}
export async function assertCatalogDocuments(storeId: string) {
  const status = await documentStatus(storeId);
  if (!status.canManageCatalog) throw new HttpError(403, status.message, undefined, "VENDOR_DOCUMENTS_REQUIRED");
}
export const requireCatalogDocuments = asyncHandler(async (request, _response, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    await assertCatalogDocuments(ownedDocumentStore(request));
  }
  next();
});
