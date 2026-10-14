import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import type { AuthenticatedRequest } from "../auth/types.js";
import { requireRole } from "../auth/middleware.js";
import { requireDeliveryPartner } from "./middleware.js";
import { HttpError, asyncHandler } from "../http.js";
import { MAX_DOCUMENT_BYTES, validateDocument } from "../vendor-documents/files.js";
import { privateObjectStorage } from "../vendor-documents/storage.js";

export const pickupPhotoStorage = privateObjectStorage("delivery-photos");
const idInput = z.string().uuid();
const metadataFields = sql`id,captured_at AS "capturedAt",uploaded_at AS "uploadedAt",mime_type AS "mimeType"`;
function assignmentId(value: unknown) {
  const parsed = idInput.safeParse(value);
  if (!parsed.success) throw new HttpError(400,"Invalid delivery identifier.");
  return parsed.data;
}
async function authorize(id: string, partnerId?: string) {
  const row = (await getDb().execute(sql`SELECT id,order_id,partner_user_id,status FROM delivery_assignments
    WHERE id=${id} ${partnerId ? sql`AND partner_user_id=${partnerId}` : sql``}`)).rows[0];
  if (!row) throw new HttpError(404,"Delivery not found.");
  return row;
}
export const pickupPhotosRouter = Router();
pickupPhotosRouter.post("/api/delivery-partner/deliveries/:assignmentId/photo",requireDeliveryPartner(),
  express.raw({type:["image/jpeg","image/png"],limit:MAX_DOCUMENT_BYTES}),asyncHandler(async(req,res) => {
    const id = assignmentId(req.params.assignmentId), partnerId = (req as AuthenticatedRequest).auth!.userId;
    const assignment = await authorize(id,partnerId);
    if (assignment.status !== "ACCEPTED") throw new HttpError(409,"A package photo can be saved or replaced only before pickup on an accepted assignment.");
    const mime = req.get("content-type")?.split(";")[0] ?? "";
    if (!["image/jpeg","image/png"].includes(mime)) throw new HttpError(400,"Use a JPEG or PNG photograph.");
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    validateDocument(typeof req.query.fileName === "string" ? req.query.fileName : `package.${mime === "image/png" ? "png" : "jpg"}`,mime,bytes);
    const captured = req.query.capturedAt === undefined ? new Date() : new Date(String(req.query.capturedAt));
    if (!Number.isFinite(captured.getTime()) || captured.getTime()>Date.now()+60_000 || captured.getTime()<Date.now()-86_400_000)
      throw new HttpError(400,"Capture time must be a valid recent timestamp.");
    const directory = process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/,"");
    if (!directory) throw new HttpError(503,"Private image storage is unavailable. Pickup has not been confirmed.");
    const photoId = randomUUID(), ref = `${directory}/delivery-photos/${id}/${photoId}`;
    await pickupPhotoStorage.put(ref,bytes,mime);
    let previous: string | undefined;
    try {
      await getDb().transaction(async tx => {
        // Same lock order as pickup/assignment paths.
        await tx.execute(sql`SELECT id FROM orders WHERE id=${assignment.order_id} FOR UPDATE`);
        const partner = (await tx.execute(sql`SELECT p.status FROM delivery_partner_profiles p JOIN user_profiles u ON u.id=p.user_id
          WHERE p.user_id=${partnerId} AND u.role='delivery_partner' FOR SHARE OF p,u`)).rows[0];
        const current = (await tx.execute(sql`SELECT status FROM delivery_assignments
          WHERE id=${id} AND partner_user_id=${partnerId} FOR UPDATE`)).rows[0];
        if (partner?.status !== "ACTIVE" || current?.status !== "ACCEPTED") throw new HttpError(409,"Assignment changed or partner is inactive. Pickup has not been confirmed.");
        const old = (await tx.execute(sql`SELECT object_ref FROM delivery_pickup_photos WHERE assignment_id=${id}`)).rows[0];
        previous = old ? String(old.object_ref) : undefined;
        await tx.execute(sql`INSERT INTO delivery_pickup_photos(id,assignment_id,order_id,partner_user_id,object_ref,mime_type,size_bytes,captured_at)
          VALUES(${photoId},${id},${assignment.order_id},${partnerId},${ref},${mime},${bytes.length},${captured})
          ON CONFLICT(assignment_id) DO UPDATE SET id=excluded.id,object_ref=excluded.object_ref,mime_type=excluded.mime_type,
            size_bytes=excluded.size_bytes,captured_at=excluded.captured_at,uploaded_at=clock_timestamp()`);
      });
    } catch(error) {
      await pickupPhotoStorage.discard(ref).catch(() => undefined);
      throw error;
    }
    if (previous) await pickupPhotoStorage.discard(previous).catch(() => undefined);
    const photo = (await getDb().execute(sql`SELECT ${metadataFields} FROM delivery_pickup_photos WHERE assignment_id=${id}`)).rows[0];
    res.setHeader("Cache-Control","private, no-store");
    res.status(201).json({photo});
  }));
for (const admin of [false,true]) {
  const path = admin ? "/api/admin/deliveries/:assignmentId/photo" : "/api/delivery-partner/deliveries/:assignmentId/photo";
  const guard = admin ? requireRole("admin") : requireDeliveryPartner();
  pickupPhotosRouter.get(`${path}/metadata`,guard,asyncHandler(async(req,res) => {
    const id = assignmentId(req.params.assignmentId);
    await authorize(id,admin ? undefined : (req as AuthenticatedRequest).auth!.userId);
    const photo = (await getDb().execute(sql`SELECT ${metadataFields} FROM delivery_pickup_photos WHERE assignment_id=${id}`)).rows[0] ?? null;
    res.setHeader("Cache-Control","private, no-store"); res.json({photo});
  }));
  pickupPhotosRouter.get(path,guard,asyncHandler(async(req,res) => {
    const id = assignmentId(req.params.assignmentId);
    await authorize(id,admin ? undefined : (req as AuthenticatedRequest).auth!.userId);
    const photo = (await getDb().execute(sql`SELECT object_ref,mime_type FROM delivery_pickup_photos WHERE assignment_id=${id}`)).rows[0];
    if (!photo) throw new HttpError(404,"No saved package photograph.");
    const bytes = await pickupPhotoStorage.get(String(photo.object_ref));
    res.setHeader("Cache-Control","private, no-store");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Content-Security-Policy","default-src 'none'; sandbox");
    res.type(String(photo.mime_type)).send(bytes);
  }));
}
pickupPhotosRouter.get("/api/admin/orders/:orderId/delivery",requireRole("admin"),asyncHandler(async(req,res) => {
  const id = assignmentId(req.params.orderId);
  const rows = await getDb().execute(sql`SELECT a.id,a.partner_user_id AS "partnerUserId",p.display_name AS "partnerName",a.status,
    a.assigned_at AS "assignedAt",a.accepted_at AS "acceptedAt",a.rejected_at AS "rejectedAt",
    a.picked_up_at AS "pickedUpAt",a.delivered_at AS "deliveredAt",a.updated_at AS "updatedAt"
    FROM delivery_assignments a JOIN delivery_partner_profiles p ON p.user_id=a.partner_user_id WHERE a.order_id=${id}
    ORDER BY a.assigned_at DESC,a.id DESC`);
  res.setHeader("Cache-Control","private, no-store");
  res.json({assignments:rows.rows});
}));
