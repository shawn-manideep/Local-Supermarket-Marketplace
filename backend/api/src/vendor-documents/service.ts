import { eq, sql } from "drizzle-orm";
import { getDb, stores } from "@workspace/db";
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
  const [store] = await getDb().select({ required: stores.documentsRequired }).from(stores).where(eq(stores.id, storeId));
  if (!store) throw new HttpError(404, "Vendor store not found");
  const result = await getDb().execute(sql`
    SELECT id,document_type AS type,file_name AS "fileName",mime_type AS "mimeType",
      size_bytes AS "sizeBytes",uploaded_at AS "uploadedAt",updated_at AS "updatedAt",version
    FROM vendor_documents WHERE store_id=${storeId} AND is_current ORDER BY document_type`);
  const documents = DOCUMENT_TYPES.map(type => ({
    ...type, current: result.rows.find(row => row.type === type.type) ?? null,
  }));
  const mandatoryCount = documents.filter(item => item.mandatory && item.current).length;
  const optionalCount = documents.filter(item => !item.mandatory && item.current).length;
  return { required: store.required, mandatoryCount, optionalCount,
    canManageCatalog: !store.required || mandatoryCount === 4,
    message: mandatoryCount === 4
      ? "Your mandatory documents are complete. You can now manage your catalog."
      : "Complete your document verification before managing your catalog.",
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
