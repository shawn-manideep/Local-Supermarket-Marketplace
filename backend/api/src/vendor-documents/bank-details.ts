import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { indianMobileSchema } from "@workspace/validation";
import { requireRole } from "../auth/middleware.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError } from "../http.js";
import { adminDocumentStore, ownedDocumentStore } from "./service.js";

const requiredText = z.string().trim().min(2).max(120);
export const bankDetailsInput = z.object({
  accountHolderName: requiredText,
  // Indian account formats vary; preserve leading zeros and never coerce to a number.
  accountNumber: z.string().trim().regex(/^\d{6,34}$/).optional(),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  bankName: requiredText, bankBranch: requiredText,
  vendorMobileNumber: indianMobileSchema,
}).strict();
const reviewInput = z.object({
  submissionId: z.string().uuid(), action: z.enum(["APPROVE","REJECT"]),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict().refine(v => v.action !== "REJECT" || !!v.reason);
export const maskBankAccount = (number: string) => `${"•".repeat(Math.max(4, number.length - 4))}${number.slice(-4)}`;

export async function readBankDetails(storeId: string, reveal = false) {
  const rows = await getDb().execute(sql`SELECT account_holder_name AS "accountHolderName",
    account_number AS "accountNumber",ifsc,bank_name AS "bankName",bank_branch AS "bankBranch",
    vendor_mobile_number AS "vendorMobileNumber",status,submission_id AS "submissionId",
    rejection_reason AS "rejectionReason",submitted_at AS "submittedAt",reviewed_at AS "reviewedAt"
    FROM vendor_bank_details WHERE store_id=${storeId}`);
  const row = rows.rows[0];
  const history = await getDb().execute(sql`SELECT action,created_at AS "createdAt",
    previous_status AS "previousStatus",next_status AS "nextStatus",details
    FROM platform_management_events WHERE target_type='store' AND target_id=${storeId}
      AND action LIKE 'bank_details_%' ORDER BY created_at DESC,id DESC`);
  if (!row) return { bankDetails: null, history: history.rows };
  const { accountNumber, ...safe } = row;
  return { bankDetails: { ...safe, maskedAccountNumber: maskBankAccount(String(accountNumber)),
    ...(reveal ? { accountNumber } : {}) }, history: history.rows };
}
export const bankDetailsRouter = Router();
bankDetailsRouter.use(["/api/vendor/bank-details","/api/admin/vendors/:vendorId/bank-details"],
  (_req,res,next) => { res.setHeader("Cache-Control","private, no-store"); next(); });
bankDetailsRouter.get("/api/vendor/bank-details", requireRole("vendor"), asyncHandler(async (req,res) => {
  res.json(await readBankDetails(ownedDocumentStore(req)));
}));
bankDetailsRouter.patch("/api/vendor/bank-details", requireRole("vendor"), asyncHandler(async (req,res) => {
  const parsed = bankDetailsInput.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400,"Enter valid required bank details, IFSC and Indian mobile number.");
  const storeId = ownedDocumentStore(req), actor = (req as AuthenticatedRequest).auth!.userId;
  await getDb().transaction(async tx => {
    await tx.execute(sql`SELECT id FROM stores WHERE id=${storeId} FOR UPDATE`);
    const old = (await tx.execute(sql`SELECT status,account_number FROM vendor_bank_details WHERE store_id=${storeId} FOR UPDATE`)).rows[0];
    const input = parsed.data, account = input.accountNumber ?? old?.account_number;
    if (!account) throw new HttpError(400,"Bank account number is required for the first submission.");
    await tx.execute(sql`INSERT INTO vendor_bank_details(store_id,account_holder_name,account_number,ifsc,
      bank_name,bank_branch,vendor_mobile_number,submission_id)
      VALUES(${storeId},${input.accountHolderName},${account},${input.ifsc},${input.bankName},
        ${input.bankBranch},${input.vendorMobileNumber},${randomUUID()})
      ON CONFLICT(store_id) DO UPDATE SET account_holder_name=excluded.account_holder_name,
        account_number=excluded.account_number,ifsc=excluded.ifsc,bank_name=excluded.bank_name,
        bank_branch=excluded.bank_branch,vendor_mobile_number=excluded.vendor_mobile_number,
        submission_id=excluded.submission_id,status='SUBMITTED',rejection_reason=NULL,
        submitted_at=clock_timestamp(),reviewed_at=NULL,reviewed_by=NULL`);
    await tx.execute(sql`INSERT INTO platform_management_events(actor_user_id,action,target_type,target_id,previous_status,next_status)
      VALUES(${actor},'bank_details_submitted','store',${storeId},${old?.status ?? null},'SUBMITTED')`);
  });
  res.json(await readBankDetails(storeId));
}));
bankDetailsRouter.get("/api/admin/vendors/:vendorId/bank-details", requireRole("admin"), asyncHandler(async (req,res) => {
  res.json(await readBankDetails(await adminDocumentStore(String(req.params.vendorId)),req.query.reveal === "true"));
}));
bankDetailsRouter.post("/api/admin/vendors/:vendorId/bank-details/review",requireRole("admin"),asyncHandler(async(req,res) => {
  const input = reviewInput.safeParse(req.body);
  if (!input.success) throw new HttpError(400,"Provide the current submission, a valid decision and a rejection reason when rejecting.");
  const storeId = await adminDocumentStore(String(req.params.vendorId)), actor = (req as AuthenticatedRequest).auth!.userId;
  await getDb().transaction(async tx => {
    await tx.execute(sql`SELECT id FROM stores WHERE id=${storeId} FOR UPDATE`);
    const row = (await tx.execute(sql`SELECT status,submission_id FROM vendor_bank_details WHERE store_id=${storeId} FOR UPDATE`)).rows[0];
    if (!row || row.status !== "SUBMITTED" || row.submission_id !== input.data.submissionId)
      throw new HttpError(409,"This bank submission changed or was already reviewed. Refresh before deciding.");
    const next = input.data.action === "APPROVE" ? "APPROVED" : "REJECTED";
    await tx.execute(sql`UPDATE vendor_bank_details SET status=${next},reviewed_at=clock_timestamp(),
      reviewed_by=${actor},rejection_reason=${next === "REJECTED" ? input.data.reason : null} WHERE store_id=${storeId}`);
    await tx.execute(sql`INSERT INTO platform_management_events(actor_user_id,action,target_type,target_id,previous_status,next_status,details)
      VALUES(${actor},${next === "APPROVED" ? "bank_details_approved" : "bank_details_rejected"},'store',${storeId},'SUBMITTED',${next},
        ${JSON.stringify({ submissionId: input.data.submissionId, reason: input.data.reason ?? null })}::jsonb)`);
  });
  res.json(await readBankDetails(storeId));
}));
