import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { HttpError } from "../http.js";
import { LEGAL_ORDER_TRANSITIONS } from "../orders/lifecycle.js";

type Database = Pick<ReturnType<typeof getDb>, "execute" | "transaction">;
type Actor = { userId: string; storeId: string | null };
type DutyAction = "ACCEPT" | "REJECT" | "PICKUP" | "START" | "DELIVER";
export const DUTY_TRANSITIONS = {
  ACCEPT: ["PENDING", "ACCEPTED"], REJECT: ["PENDING", "REJECTED"],
  PICKUP: ["ACCEPTED", "PICKED_UP"], START: ["PICKED_UP", "OUT_FOR_DELIVERY"],
  DELIVER: ["OUT_FOR_DELIVERY", "DELIVERED"],
} as const;
function fail(code: string, message: string, status = 409): never {
  throw new HttpError(status, message, undefined, code);
}
const view = sql`a.id,a.order_id AS "orderId",
  o.delivery_mode AS "deliveryMode",o.scheduled_start_at AS "scheduledStartAt",o.scheduled_end_at AS "scheduledEndAt",
  upper(left(a.order_id::text,8)) AS "orderReference",s.name AS "storeName",
  o.status AS "orderStatus",o.total_amount::text AS "orderTotal",p.display_name AS "partnerName",
  a.status,a.assigned_at AS "assignedAt",a.accepted_at AS "acceptedAt",
  a.rejected_at AS "rejectedAt",a.picked_up_at AS "pickedUpAt",a.delivered_at AS "deliveredAt",
  a.created_at AS "createdAt",a.updated_at AS "updatedAt",
  CASE WHEN a.status NOT IN ('REJECTED','CANCELLED') THEN
    jsonb_build_object('line1',o.delivery_address_snapshot->>'line1',
      'line2',o.delivery_address_snapshot->>'line2','city',o.delivery_address_snapshot->>'city',
      'state',o.delivery_address_snapshot->>'state','pincode',o.delivery_address_snapshot->>'pincode')
    ELSE NULL END AS "deliveryAddress",
  CASE WHEN a.status NOT IN ('REJECTED','CANCELLED') THEN o.delivery_contact_name ELSE NULL END AS "recipientName"`;
const joins = sql`FROM delivery_assignments a JOIN orders o ON o.id=a.order_id
  JOIN stores s ON s.id=o.store_id JOIN delivery_partner_profiles p ON p.user_id=a.partner_user_id`;

export function deliveryWorkflow(db: Database = getDb()) {
  async function active(tx: Database, id: string) {
    const result = await tx.execute(sql`SELECT p.status,u.role FROM delivery_partner_profiles p
      JOIN user_profiles u ON u.id=p.user_id WHERE p.user_id=${id} FOR SHARE OF p,u`);
    const partner = result.rows[0];
    if (!partner || partner.role !== "delivery_partner") fail("PARTNER_NOT_FOUND", "Delivery partner not found.", 404);
    if (partner.status !== "ACTIVE") fail("PARTNER_INACTIVE", "Delivery partner is inactive.", 403);
  }
  async function vendorOrder(tx: Database, actor: Actor, id: string, lock = false) {
    const result = await tx.execute(sql`SELECT o.id,o.status FROM orders o
      JOIN stores s ON s.id=o.store_id JOIN user_profiles u ON u.id=s.owner_user_id
      WHERE o.id=${id} AND o.store_id=${actor.storeId} AND s.owner_user_id=${actor.userId} AND u.role='vendor'
      ${lock ? sql`FOR UPDATE OF o` : sql``}`);
    if (!result.rows[0]) fail("UNAUTHORIZED_DELIVERY_ACTION", "Order not found in your store.", 404);
    return result.rows[0];
  }
  async function vendorRead(actor: Actor, orderId: string) {
    await vendorOrder(db, actor, orderId);
    const result = await db.execute(sql`SELECT ${view} ${joins}
      WHERE o.id=${orderId} AND o.store_id=${actor.storeId} AND s.owner_user_id=${actor.userId}
      ORDER BY a.assigned_at DESC,a.id DESC LIMIT 1`);
    return result.rows[0] ?? null;
  }
  async function own(id: string, assignmentId?: string) {
    const result = await db.execute(sql`SELECT ${view} ${joins}
      JOIN user_profiles u ON u.id=p.user_id
      WHERE a.partner_user_id=${id} AND p.status='ACTIVE' AND u.role='delivery_partner'
      ${assignmentId ? sql`AND a.id=${assignmentId}` : sql``}
      ORDER BY a.assigned_at DESC,a.id DESC LIMIT 100`);
    if (assignmentId && !result.rows[0]) fail("NOT_ASSIGNED_PARTNER", "This assignment is not available to you.", 403);
    return assignmentId ? result.rows[0] : result.rows;
  }
  return {
    vendorRead, own,
    async available(partnerId: string) {
      await active(db, partnerId);
      const result = await db.execute(sql`SELECT o.id AS "orderId",upper(left(o.id::text,8)) AS "orderReference",
        s.id AS "storeId",s.name AS "storeName",o.total_amount::text AS "orderTotal",
        o.delivery_mode AS "deliveryMode",o.scheduled_start_at AS "scheduledStartAt",o.scheduled_end_at AS "scheduledEndAt"
        FROM orders o JOIN stores s ON s.id=o.store_id WHERE o.status='READY'
        AND (o.delivery_mode<>'SCHEDULED' OR o.scheduled_end_at>clock_timestamp())
        AND NOT EXISTS(SELECT 1 FROM delivery_assignments a WHERE a.order_id=o.id
          AND a.status IN ('PENDING','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED'))
        ORDER BY o.created_at,o.id`);
      return result.rows;
    },
    async claim(partnerId: string, orderId: string) {
      const assignmentId = await db.transaction(async tx => {
        const order = (await tx.execute(sql`SELECT status,delivery_mode,scheduled_end_at,
          (scheduled_end_at>clock_timestamp()) AS offer_not_expired FROM orders WHERE id=${orderId} FOR UPDATE`)).rows[0];
        await active(tx,partnerId);
        const existing = await tx.execute(sql`SELECT id,partner_user_id,status FROM delivery_assignments WHERE order_id=${orderId}
          AND status IN ('PENDING','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED')`);
        const previous = existing.rows[0];
        if (previous?.partner_user_id === partnerId && ["ACCEPTED","PICKED_UP","OUT_FOR_DELIVERY","DELIVERED"].includes(String(previous.status)))
          return String(previous.id); // Retry of a successful claim, not another duty.
        if (!order || order.status !== "READY" || (order.delivery_mode === "SCHEDULED" && !order.offer_not_expired))
          fail("DELIVERY_UNAVAILABLE","This delivery is no longer available or its scheduled offer has expired.");
        if (existing.rows.length) fail("DELIVERY_UNAVAILABLE","Another partner already accepted this delivery. Refresh available deliveries.");
        const inserted = await tx.execute(sql`INSERT INTO delivery_assignments(order_id,partner_user_id,status,assigned_at,accepted_at)
          VALUES(${orderId},${partnerId},'ACCEPTED',transaction_timestamp(),clock_timestamp()) RETURNING id`);
        return String(inserted.rows[0]!.id);
      });
      return own(partnerId,assignmentId);
    },
    async eligible(actor: Actor) {
      const result = await db.execute(sql`SELECT p.user_id AS id,p.display_name AS "displayName",p.status
        FROM delivery_partner_profiles p JOIN user_profiles u ON u.id=p.user_id
        WHERE p.status='ACTIVE' AND u.role='delivery_partner' AND EXISTS (
          SELECT 1 FROM stores s JOIN user_profiles v ON v.id=s.owner_user_id
          WHERE s.id=${actor.storeId} AND s.owner_user_id=${actor.userId} AND v.role='vendor')
        ORDER BY p.display_name,p.user_id`);
      return result.rows;
    },
    async assign(actor: Actor, orderId: string, partnerId: string) {
      await db.transaction(async tx => {
        const order = await vendorOrder(tx, actor, orderId, true);
        if (order.status !== "READY") fail("ORDER_NOT_READY", "Delivery partner can only be assigned after the order is marked Ready.");
        await active(tx, partnerId);
        const existing = await tx.execute(sql`SELECT id,status,partner_user_id FROM delivery_assignments
          WHERE order_id=${orderId} AND status IN ('PENDING','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY') FOR UPDATE`);
        const assignment = existing.rows[0];
        if (assignment) {
          if (assignment.status !== "PENDING" || assignment.partner_user_id === partnerId) {
            fail("ASSIGNMENT_ALREADY_HANDLED", "An assignment is already active. Accepted duties cannot be replaced.");
          }
          await tx.execute(sql`UPDATE delivery_assignments SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=${assignment.id}`);
        }
        await tx.execute(sql`INSERT INTO delivery_assignments(order_id,partner_user_id,status,assigned_at)
          VALUES(${orderId},${partnerId},'PENDING',clock_timestamp())`);
      }, { isolationLevel: "read committed" });
      return vendorRead(actor, orderId);
    },
    async action(partnerId: string, assignmentId: string, action: DutyAction) {
      await db.transaction(async tx => {
        // Resolve ownership first without locking another partner's order.
        const lookup = await tx.execute(sql`SELECT order_id FROM delivery_assignments WHERE id=${assignmentId} AND partner_user_id=${partnerId}`);
        if (!lookup.rows[0]) fail("NOT_ASSIGNED_PARTNER", "This assignment does not belong to you.", 403);
        const orderId = lookup.rows[0].order_id;
        // All mutation paths lock order first, then profile and assignment.
        const orderRows = await tx.execute(sql`SELECT status,delivery_mode,scheduled_start_at,
          (scheduled_start_at>clock_timestamp()) AS "awaitingSlot" FROM orders WHERE id=${orderId} FOR UPDATE`);
        const order = orderRows.rows[0];
        if (!order) fail("INVALID_ASSIGNMENT", "The assigned order is unavailable.", 404);
        await active(tx, partnerId);
        const rows = await tx.execute(sql`SELECT status FROM delivery_assignments
          WHERE id=${assignmentId} AND partner_user_id=${partnerId} FOR UPDATE`);
        const assignment = rows.rows[0];
        if (!assignment) fail("INVALID_ASSIGNMENT", "The assignment is unavailable.", 404);
        if (assignment.status === "DELIVERED") fail("DELIVERY_ALREADY_COMPLETED", "Delivery is already completed.");
        const [from, to] = DUTY_TRANSITIONS[action];
        if (assignment.status !== from) fail(
          ["ACCEPT","REJECT"].includes(action) ? "ASSIGNMENT_NOT_PENDING" : "INVALID_DELIVERY_TRANSITION",
          `Cannot ${action.toLowerCase()} an assignment in ${assignment.status} state.`);
        if (["PICKUP", "START"].includes(action) && orderRows.rows[0]?.delivery_mode === "SCHEDULED" && orderRows.rows[0]?.awaitingSlot)
          fail("SCHEDULED_DELIVERY_NOT_DUE", "Pickup and dispatch are available only when the scheduled delivery window starts.");
        const requiredOrder = action === "DELIVER" ? "OUT_FOR_DELIVERY" : "READY";
        if (order.status !== requiredOrder) fail("INVALID_DELIVERY_TRANSITION", "The order is no longer eligible for this delivery action.");
        if (action === "PICKUP") {
          const photo = await tx.execute(sql`SELECT id FROM delivery_pickup_photos
            WHERE assignment_id=${assignmentId} AND order_id=${orderId} AND partner_user_id=${partnerId}`);
          if (!photo.rows.length) fail("PICKUP_PHOTO_REQUIRED","Securely upload one complete package photograph before confirming pickup.");
        }
        const timestamp = {
          ACCEPT: sql`accepted_at=clock_timestamp()`, REJECT: sql`rejected_at=clock_timestamp()`,
          PICKUP: sql`picked_up_at=clock_timestamp()`, START: sql`updated_at=clock_timestamp()`,
          DELIVER: sql`delivered_at=clock_timestamp()`,
        }[action];
        if (action === "START" || action === "DELIVER") {
          const orderAction = action === "START" ? "OUT_FOR_DELIVERY" : "DELIVER";
          const next = LEGAL_ORDER_TRANSITIONS[orderAction]?.[String(order.status)];
          if (next !== to) fail("INVALID_DELIVERY_TRANSITION", "Illegal order delivery transition.");
          await tx.execute(sql`UPDATE orders SET status=${next}::order_status,updated_at=clock_timestamp() WHERE id=${orderId}`);
          await tx.execute(sql`INSERT INTO order_status_history(order_id,status,changed_by,created_at)
            VALUES(${orderId},${next}::order_status,${partnerId},clock_timestamp())`);
        }
        await tx.execute(sql`UPDATE delivery_assignments SET status=${to},${timestamp}
          ${action === "START" ? sql`` : sql`,updated_at=clock_timestamp()`} WHERE id=${assignmentId}`);
      }, { isolationLevel: "read committed" });
      return own(partnerId, assignmentId);
    },
    async dashboard(id: string) {
      const result = await db.execute(sql`SELECT count(*)::integer AS total,
        count(*) FILTER(WHERE a.status='PENDING')::integer AS pending,
        count(*) FILTER(WHERE a.status='ACCEPTED')::integer AS accepted,
        count(*) FILTER(WHERE a.status='PICKED_UP')::integer AS "pickedUp",
        count(*) FILTER(WHERE a.status='OUT_FOR_DELIVERY')::integer AS "outForDelivery",
        count(*) FILTER(WHERE a.status='DELIVERED')::integer AS delivered,
        count(*) FILTER(WHERE a.status='PENDING')::integer AS assigned,
        count(*) FILTER(WHERE a.status IN ('ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY'))::integer AS "inProgress",
        count(*) FILTER(WHERE a.status='DELIVERED')::integer AS completed,
        count(*) FILTER(WHERE a.status='CANCELLED')::integer AS cancelled,
        count(*) FILTER(WHERE a.status='REJECTED')::integer AS rejected
        FROM delivery_assignments a JOIN delivery_partner_profiles p ON p.user_id=a.partner_user_id
        JOIN user_profiles u ON u.id=p.user_id WHERE a.partner_user_id=${id} AND p.status='ACTIVE' AND u.role='delivery_partner'
          AND a.assigned_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`);
      return result.rows[0]!;
    },
  };
}