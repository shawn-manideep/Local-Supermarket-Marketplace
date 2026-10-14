import { Router, type Response } from "express";
import type { PoolClient, Notification } from "pg";
import { getPool } from "@workspace/db";
import { requireRole } from "./auth/index.js";
import { requireDeliveryPartner } from "./delivery-partner/middleware.js";
import type { AuthenticatedRequest } from "./auth/types.js";
import { asyncHandler, HttpError } from "./http.js";

type Subscription = { role: "vendor" | "delivery_partner"; storeId: string | null; response: Response };
const subscriptions = new Set<Subscription>();
let client: PoolClient | undefined;
let connecting: Promise<void> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;

/** Payloads never leave the server; clients receive only a scoped refresh hint. */
export function eventApplies(payload: string, role: Subscription["role"], storeId: string | null) {
  try {
    const event = JSON.parse(payload) as { kind?: string; storeId?: string };
    return role === "vendor" ? event.kind === "NEW_ORDER" && !!storeId && event.storeId === storeId
      : event.kind === "DELIVERY_OFFERS";
  } catch { return false; }
}
function publish(notification: Notification) {
  if (notification.channel !== "marketplace_portal_events" || !notification.payload) return;
  for (const sub of subscriptions) {
    if (!sub.response.destroyed && sub.response.headersSent && eventApplies(notification.payload, sub.role, sub.storeId))
      sub.response.write("event: refresh\ndata: {}\n\n");
  }
}
function scheduleReconnect() {
  if (!subscriptions.size || retry) return;
  retry = setTimeout(() => {
    retry = undefined;
    void ensureListener().then(() => {
      for (const sub of subscriptions) if (!sub.response.destroyed && sub.response.headersSent)
        sub.response.write("event: refresh\ndata: {}\n\n"); // Rehydrate after an outage.
    }).catch(scheduleReconnect);
  }, 3_000);
  retry.unref();
}
async function ensureListener() {
  if (client) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const connection = await getPool().connect();
    const connectionError = () => {
      if (client === connection) {
        client = undefined;
        connection.release(true);
        scheduleReconnect();
      }
    };
    connection.on("error", connectionError);
    try {
      await connection.query("LISTEN marketplace_portal_events");
      client = connection;
      connection.on("notification", publish);
    } catch (error) {
      connection.off("error", connectionError);
      connection.release(true);
      throw error;
    }
  })();
  try { await connecting; } finally { connecting = undefined; }
}
function unsubscribe(sub: Subscription) {
  subscriptions.delete(sub);
  if (subscriptions.size) return;
  if (retry) clearTimeout(retry);
  retry = undefined;
  if (client) {
    const previous = client;
    client = undefined;
    // Destroy rather than return a LISTEN session to the transaction pool.
    previous.removeListener("notification", publish);
    previous.release(true);
  }
}
export const portalEventsRouter = Router();
for (const role of ["vendor", "delivery_partner"] as const) {
  portalEventsRouter.get(role === "vendor" ? "/api/vendor/events" : "/api/delivery-partner/events",
    role === "vendor" ? requireRole("vendor") : requireDeliveryPartner(),
    asyncHandler(async (req, res) => {
      const auth = (req as AuthenticatedRequest).auth!;
      if (role === "vendor" && !auth.storeId) throw new HttpError(404, "Vendor store not found.");
      const sub = { role, storeId: auth.storeId, response: res };
      let closed = false;
      const close = () => { closed = true; unsubscribe(sub); };
      res.once("close", close);
      subscriptions.add(sub);
      try { await ensureListener(); } catch {
        close();
        throw new HttpError(503, "Live updates are unavailable. In-app polling remains available.");
      }
      if (closed) { unsubscribe(sub); return; }
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write("event: refresh\ndata: {}\n\n");
      const heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(": heartbeat\n\n");
      }, 15_000);
      heartbeat.unref();
      res.once("close", () => clearInterval(heartbeat));
    }));
}
