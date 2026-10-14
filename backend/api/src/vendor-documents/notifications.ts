import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@workspace/db";
import { requireRole } from "../auth/index.js";
import { asyncHandler, HttpError } from "../http.js";
import { adminDocumentStore, ownedDocumentStore } from "./service.js";

export async function vendorNotificationFeed(storeId: string, admin = false) {
  // A durable uniqueness key makes simultaneous polls/reloads safe. No scheduler
  // or push is implied: milestones are evaluated when a portal requests the feed.
  await getDb().execute(sql`INSERT INTO vendor_notifications
    (store_id,kind,dedup_key,message,document_id,expiry_date,milestone)
    SELECT d.store_id,'FSSAI_EXPIRY','fssai:'||d.id::text||':'||d.expiry_date::text||':'||m.milestone,
      CASE WHEN m.milestone='0' THEN 'FSSAI license expired on '||d.expiry_date::text||'. Renew and submit for review.'
        ELSE 'FSSAI license expires on '||d.expiry_date::text||'. Renew before expiry.' END,
      d.id,d.expiry_date,m.milestone
    FROM vendor_documents d CROSS JOIN LATERAL (
      SELECT CASE WHEN d.expiry_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date THEN '0'
        WHEN d.expiry_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date+7 THEN '7'
        WHEN d.expiry_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date+30 THEN '30' END AS milestone
    ) m WHERE d.store_id=${storeId} AND d.document_type='fssai' AND d.is_current
      AND d.expiry_date IS NOT NULL AND m.milestone IS NOT NULL
    ON CONFLICT(dedup_key) DO NOTHING`);
  const result = await getDb().execute(sql`SELECT n.id,n.kind,n.message,n.order_id AS "orderId",
    n.document_id AS "documentId",n.expiry_date::text AS "expiryDate",n.milestone,
    n.created_at AS "createdAt",n.read_at AS "readAt"
    FROM vendor_notifications n WHERE n.store_id=${storeId}
      ${admin ? sql`` : sql`AND (n.kind='NEW_ORDER' OR EXISTS(SELECT 1 FROM vendor_documents d
        WHERE d.id=n.document_id AND d.is_current AND d.expiry_date=n.expiry_date))`}
    ORDER BY (n.read_at IS NULL) DESC,n.created_at DESC,n.id DESC LIMIT 200`);
  return { deliveryMode: "IN_APP_REALTIME_WITH_POLLING" as const, notifications: result.rows };
}
export const vendorNotificationsRouter = Router();
vendorNotificationsRouter.get("/api/vendor/notifications", requireRole("vendor"), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await vendorNotificationFeed(ownedDocumentStore(req)));
}));
vendorNotificationsRouter.post("/api/vendor/notifications/:notificationId/read", requireRole("vendor"), asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.notificationId);
  if (!id.success) throw new HttpError(400, "Invalid notification identifier.");
  const result = await getDb().execute(sql`UPDATE vendor_notifications SET read_at=coalesce(read_at,now())
    WHERE id=${id.data} AND store_id=${ownedDocumentStore(req)} RETURNING id`);
  if (!result.rows.length) throw new HttpError(404, "Notification not found.");
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ ok: true });
}));
vendorNotificationsRouter.get("/api/admin/vendors/:vendorId/notifications", requireRole("admin"), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await vendorNotificationFeed(await adminDocumentStore(String(req.params.vendorId)), true));
}));
