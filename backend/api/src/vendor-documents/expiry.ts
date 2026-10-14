import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@workspace/db";
import { HttpError } from "../http.js";

const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value &&
    value >= "1900-01-01" && value <= "9999-12-31";
}, "Provide a real calendar date as YYYY-MM-DD.");
export const fssaiExpiryInput = z.object({ expiryDate: calendarDay }).strict();
export function indiaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function fssaiStatus(expiryDate: string | null, today = indiaDate()) {
  if (!expiryDate) return { expiryDate: null, status: "DATE_REQUIRED" as const, daysRemaining: null };
  const daysRemaining = Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { expiryDate, daysRemaining,
    status: daysRemaining <= 0 ? "EXPIRED" as const : daysRemaining <= 30 ? "EXPIRING_SOON" as const : "VALID" as const };
}
export function expiryMilestone(daysRemaining: number) {
  return daysRemaining <= 0 ? "0" : daysRemaining <= 7 ? "7" : daysRemaining <= 30 ? "30" : null;
}
export async function saveFssaiExpiry(storeId: string, documentId: string, actorId: string,
  expiryDate: string, admin: boolean) {
  await getDb().transaction(async tx => {
    // Same lock order as document replacement and review.
    const store = (await tx.execute(sql`SELECT document_verification_status FROM stores
      WHERE id=${storeId} FOR UPDATE`)).rows[0];
    if (!store) throw new HttpError(404, "Vendor store not found.");
    const doc = (await tx.execute(sql`SELECT id,expiry_date::text AS expiry
      FROM vendor_documents WHERE id=${documentId} AND store_id=${storeId}
      AND document_type='fssai' AND is_current FOR UPDATE`)).rows[0];
    if (!doc) throw new HttpError(404, "Current FSSAI document not found.");
    if (doc.expiry === expiryDate) return; // A retry does not invalidate review twice.
    if (!admin && store.document_verification_status === "SUBMITTED")
      throw new HttpError(409, "Submitted documents are locked while Admin reviews them.", undefined, "DOCUMENTS_PENDING_REVIEW");
    await tx.execute(sql`UPDATE vendor_documents SET expiry_date=${expiryDate}::date WHERE id=${documentId}`);
    await tx.execute(sql`UPDATE vendor_documents SET verification_status='DRAFT',submission_id=NULL,
      rejection_reason=NULL,updated_at=now() WHERE store_id=${storeId} AND is_current
      AND document_type IN ('fssai','aadhaar','pan','labour_license')`);
    await tx.execute(sql`UPDATE stores SET document_verification_status='DRAFT',document_submission_id=NULL,
      documents_submitted_at=NULL,documents_reviewed_at=NULL,documents_reviewed_by=NULL,document_rejection_reason=NULL
      WHERE id=${storeId}`);
    await tx.execute(sql`INSERT INTO platform_management_events(actor_user_id,action,target_type,target_id,previous_status,next_status,details)
      VALUES(${actorId},'fssai_expiry_updated','store',${storeId},${store.document_verification_status},'DRAFT',
        ${JSON.stringify({ documentId, previousExpiryDate: doc.expiry, expiryDate })}::jsonb)`);
  });
}
