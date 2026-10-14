import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, check, foreignKey } from "drizzle-orm/pg-core";
import { stores, userProfiles, deliveryAssignments } from "./index.js";

export const vendorBankDetails = pgTable("vendor_bank_details",{
  storeId:uuid("store_id").primaryKey().references(()=>stores.id,{onDelete:"restrict"}),
  accountHolderName:text("account_holder_name").notNull(),
  accountNumber:text("account_number").notNull(),
  ifsc:text("ifsc").notNull(),bankName:text("bank_name").notNull(),bankBranch:text("bank_branch").notNull(),
  vendorMobileNumber:text("vendor_mobile_number").notNull(),
  status:text("status").notNull().default("SUBMITTED"),
  submissionId:uuid("submission_id").notNull().defaultRandom(),
  rejectionReason:text("rejection_reason"),
  submittedAt:timestamp("submitted_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
  reviewedAt:timestamp("reviewed_at",{withTimezone:true}),
  reviewedBy:uuid("reviewed_by").references(()=>userProfiles.id,{onDelete:"set null"}),
},table=>[
  check("bank_status_check",sql`${table.status} IN ('SUBMITTED','APPROVED','REJECTED')`),
  check("bank_ifsc_check",sql`${table.ifsc} ~ '^[A-Z]{4}0[A-Z0-9]{6}$'`),
  check("bank_account_number_check",sql`${table.accountNumber} ~ '^[0-9]{6,34}$'`),
]);
export const deliveryPickupPhotos = pgTable("delivery_pickup_photos",{
  id:uuid("id").primaryKey().defaultRandom(),
  assignmentId:uuid("assignment_id").notNull().unique(),
  orderId:uuid("order_id").notNull(),
  partnerUserId:uuid("partner_user_id").notNull(),
  objectRef:text("object_ref").notNull().unique(),
  mimeType:text("mime_type").notNull(),
  sizeBytes:integer("size_bytes").notNull(),
  capturedAt:timestamp("captured_at",{withTimezone:true}).notNull(),
  uploadedAt:timestamp("uploaded_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},table=>[
  foreignKey({columns:[table.assignmentId,table.orderId,table.partnerUserId],
    foreignColumns:[deliveryAssignments.id,deliveryAssignments.orderId,deliveryAssignments.partnerUserId]}).onDelete("restrict"),
  check("pickup_photo_size_check",sql`${table.sizeBytes} BETWEEN 1 AND 5242880`),
  check("pickup_photo_type_check",sql`${table.mimeType} IN ('image/jpeg','image/png')`),
]);
