import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import type { Request } from "express";
import type { AuthenticatedRequest } from "../auth/types.js";
import { HttpError, asyncHandler } from "../http.js";
import { DOCUMENT_TYPES } from "./files.js";
import { fssaiStatus } from "./expiry.js";

export function ownedDocumentStore(request: Request) {
  const storeId = (request as AuthenticatedRequest).auth?.storeId;
  if (!storeId) throw new HttpError(404, "Vendor store not found");
  return storeId;
}
export async function documentStatus(storeId: string) {
  const storeRows = await getDb().execute(sql`SELECT documents_required AS required, status AS "storeStatus",
    public.vendor_compliance_approved(id) AS "complianceApproved",
    (SELECT status FROM vendor_bank_details b WHERE b.store_id=stores.id) AS "bankStatus",
    document_verification_status AS "verificationStatus",document_submission_id AS "submissionId",
    documents_submitted_at AS "submittedAt",documents_reviewed_at AS "reviewedAt",
    document_rejection_reason AS "rejectionReason" FROM stores WHERE id=${storeId}`);
  const store = storeRows.rows[0];
  if (!store) throw new HttpError(404, "Vendor store not found");
  const result = await getDb().execute(sql`
    SELECT id,document_type AS type,file_name AS "fileName",mime_type AS "mimeType",
      size_bytes AS "sizeBytes",uploaded_at AS "uploadedAt",updated_at AS "updatedAt",version,
      verification_status AS "verificationStatus",rejection_reason AS "rejectionReason",expiry_date::text AS "expiryDate"
    FROM vendor_documents WHERE store_id=${storeId} AND is_current ORDER BY document_type`);
  const documents = DOCUMENT_TYPES.map(type => ({
    ...type, current: result.rows.find(row => row.type === type.type) ?? null,
  }));
  const mandatoryCount = documents.filter(item => item.mandatory && item.current).length;
  const optionalCount = documents.filter(item => !item.mandatory && item.current).length;
  const verified = mandatoryCount === 4 && store.verificationStatus === "APPROVED" &&
    documents.filter(d => d.mandatory).every(d => d.current?.verificationStatus === "APPROVED");
  const verificationStatus = store.required ? store.verificationStatus : "EXEMPT";
  const fssai = fssaiStatus((result.rows.find(row => row.type === "fssai")?.expiryDate as string | null) ?? null);
  const message = fssai.status === "EXPIRED" ? "FSSAI license expired. Catalog access and new orders are restricted. Renew the license and submit for Admin review; existing fulfillment remains available."
    : fssai.status === "DATE_REQUIRED" ? "Provide the actual FSSAI expiry date and submit documents for Admin review. An unknown expiry date cannot unlock catalog access or new orders."
    : store.bankStatus !== "APPROVED" ? "Approved bank details and mandatory documents are required for catalog access and new orders. Complete Bank Details and await Admin review."
    : verified && store.storeStatus !== "ACTIVE" ? "Documents approved. Catalog access also requires Admin store approval."
    : verified ? "Documents approved. Your catalog is available."
    : verificationStatus === "SUBMITTED" ? "Documents submitted for verification. Catalog access will be enabled after approval."
    : verificationStatus === "REJECTED" ? "Documents rejected. Correct the rejected documents and resubmit for verification."
    : mandatoryCount === 4 ? "Documents uploaded. Submit them for Admin verification."
    : "Upload all mandatory documents, submit for verification and await Admin approval.";
  return { required: Boolean(store.required), mandatoryCount, optionalCount,
    canManageCatalog: Boolean(store.complianceApproved), bankStatus: store.bankStatus ?? "MISSING", verificationStatus,
    submissionId: store.submissionId, submittedAt: store.submittedAt,
    reviewedAt: store.reviewedAt, rejectionReason: store.rejectionReason, message,
    documents, fssai };
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
  if (request.method !== "OPTIONS") {
    await assertCatalogDocuments(ownedDocumentStore(request));
  }
  next();
});
