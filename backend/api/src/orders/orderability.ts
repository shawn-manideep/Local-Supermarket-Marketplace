import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { HttpError } from "../http.js";
import { indiaCurrentDayAndTime, operatingStatus, type OperatingHourValue } from "../customer-marketplace/operating-status.js";

type ReadDatabase = Pick<ReturnType<typeof getDb>, "execute">;
export interface DeliverySlot { startAt: string; endAt: string }
export const DELIVERY_TIME_ZONE = "Asia/Kolkata";

function indiaMidnight(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DELIVERY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00+05:30`).getTime();
}

export function nextOpeningAt(hours: OperatingHourValue[], now = new Date()): string | null {
  const midnight = indiaMidnight(now);
  for (let offset = 0; offset <= 7; offset++) {
    const day = midnight + offset * 86_400_000;
    const hour = hours.find(h => h.dayOfWeek === indiaCurrentDayAndTime(new Date(day)).dayOfWeek);
    if (!hour || hour.isClosed || !hour.opensAt || !hour.closesAt || hour.opensAt >= hour.closesAt) continue;
    const opening = day + (Number(hour.opensAt.slice(0, 2)) * 60 + Number(hour.opensAt.slice(3, 5))) * 60_000;
    if (Number.isFinite(opening) && opening > now.getTime()) return new Date(opening).toISOString();
  }
  return null;
}

export function shoppingAvailability(hours: OperatingHourValue[], now = new Date()) {
  const status = operatingStatus(hours, now);
  return { operatingStatus: status, timeZone: DELIVERY_TIME_ZONE,
    nextOpeningAt: status === "CLOSED" ? nextOpeningAt(hours, now) : null,
    scheduledDeliveryAvailable: deliverySlots(hours, now).length > 0 };
}

export function deliverySlots(hours: OperatingHourValue[], now = new Date()): DeliverySlot[] {
  const midnight = indiaMidnight(now);
  const slots: DeliverySlot[] = [];
  for (let offset = 0; offset < 2; offset++) {
    const day = midnight + offset * 86_400_000;
    const hour = hours.find(h => h.dayOfWeek === indiaCurrentDayAndTime(new Date(day)).dayOfWeek);
    if (!hour || hour.isClosed || !hour.opensAt || !hour.closesAt) continue;
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const open = minutes(hour.opensAt), close = minutes(hour.closesAt);
    if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) continue;
    for (let start = open; start + 60 <= close; start += 60) {
      const startAt = day + start * 60_000, endAt = startAt + 3_600_000;
      if (startAt < now.getTime()) continue;
      slots.push({ startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString() });
    }
  }
  return slots;
}

export async function storeOrderability(storeId: string, db: ReadDatabase = getDb(), lock = false) {
  const stores = await db.execute(sql`SELECT status FROM stores WHERE id=${storeId}
    ${lock ? sql`FOR UPDATE` : sql``}`);
  const rows = await db.execute(sql`SELECT day_of_week AS "dayOfWeek",opens_at AS "opensAt",
    closes_at AS "closesAt",is_closed AS "isClosed" FROM store_operating_hours WHERE store_id=${storeId}`);
  const clock = await db.execute(sql`SELECT clock_timestamp() AS now`);
  const now = new Date(String(clock.rows[0]!.now));
  const hours = rows.rows as unknown as OperatingHourValue[];
  const isActive = stores.rows[0]?.status === "ACTIVE";
  const availability = shoppingAvailability(hours, now);
  return { hours, now, isActive, ...availability,
    operatingStatus: isActive ? availability.operatingStatus : "CLOSED" as const,
    scheduledDeliveryAvailable: isActive && availability.scheduledDeliveryAvailable,
    nextOpeningAt: isActive ? availability.nextOpeningAt : null };
}

export async function assertStoreOrderable(
  storeId: string, db: ReadDatabase = getDb(), lock = true,
  mode: "INSTANT" | "SCHEDULED" | "CART" = "INSTANT",
) {
  const state = await storeOrderability(storeId, db, lock);
  if (!state.isActive) throw new HttpError(409, "This store is not available for orders.", undefined, "STORE_UNAVAILABLE");
  if (mode === "SCHEDULED" && !state.scheduledDeliveryAvailable)
    throw new HttpError(409, "No valid scheduled delivery slots are available.", undefined, "DELIVERY_SLOT_UNAVAILABLE");
  if (state.operatingStatus !== "OPEN" && (mode === "INSTANT" || !state.scheduledDeliveryAvailable)) {
    throw new HttpError(409, "This store is currently closed and cannot accept orders.", undefined, "STORE_CLOSED");
  }
  return state;
}

export function deliverySnapshot(
  input: { deliveryMode: "INSTANT" | "SCHEDULED"; scheduledStartAt?: string; scheduledEndAt?: string },
  hours: OperatingHourValue[], now: Date,
) {
  if (input.deliveryMode === "INSTANT") return { deliveryMode: "INSTANT", scheduledStartAt: null, scheduledEndAt: null };
  const slot = deliverySlots(hours, now).find(s =>
    new Date(s.startAt).getTime() === new Date(input.scheduledStartAt ?? "").getTime() &&
    new Date(s.endAt).getTime() === new Date(input.scheduledEndAt ?? "").getTime());
  if (!slot) throw new HttpError(409, "The selected delivery slot is no longer available. Choose another slot.", undefined, "DELIVERY_SLOT_UNAVAILABLE");
  return { deliveryMode: "SCHEDULED", scheduledStartAt: new Date(slot.startAt), scheduledEndAt: new Date(slot.endAt) };
}
