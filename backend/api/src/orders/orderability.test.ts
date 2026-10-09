import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { customerOrderCreateSchema } from "@workspace/validation";
import { deliverySlots, deliverySnapshot, nextOpeningAt, shoppingAvailability } from "./orderability.js";
import { operatingStatus } from "../customer-marketplace/operating-status.js";

const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek, opensAt: "08:30:00", closesAt: "20:15:00", isClosed: false,
}));
const now = new Date("2026-10-08T06:10:00Z"); // India 11:40, Thursday.
test("slots are one hour, opening-aligned, today/tomorrow only and never past", () => {
  const slots = deliverySlots(hours, now);
  assert.equal(slots[0]!.startAt, "2026-10-08T07:00:00.000Z"); // 12:30 India
  assert.equal(slots.at(-1)!.endAt, "2026-10-09T14:00:00.000Z"); // 19:30 India
  for (const slot of slots) {
    assert.ok(new Date(slot.startAt).getTime() >= now.getTime());
    assert.equal(new Date(slot.endAt).getTime() - new Date(slot.startAt).getTime(), 3_600_000);
    assert.ok(["2026-10-08", "2026-10-09"].includes(new Date(new Date(slot.startAt).getTime() + 19_800_000).toISOString().slice(0, 10)));
  }
});
test("closed days, missing hours and undersized/overnight windows produce no arbitrary slots", () => {
  assert.equal(deliverySlots(hours.map(h => ({ ...h, isClosed: true })), now).length, 0);
  assert.equal(deliverySlots([], now).length, 0);
  assert.equal(deliverySlots(hours.map(h => ({ ...h, closesAt: "08:45" })), now).length, 0);
  assert.equal(deliverySlots(hours.map(h => ({ ...h, opensAt: "22:00", closesAt: "02:00" })), now).length, 0);
});
test("a closed tomorrow is excluded while today's available hours remain", () => {
  const slots = deliverySlots(hours.map(h => ({ ...h, isClosed: h.dayOfWeek === 5 })), now);
  assert.ok(slots.length);
  assert.ok(slots.every(s => s.startAt.startsWith("2026-10-08")));
});
test("Today remains eligible before opening and expired/started slots disappear as time advances", () => {
  const before = new Date("2026-10-08T02:00:00Z");
  assert.equal(shoppingAvailability(hours, before).operatingStatus, "CLOSED");
  assert.ok(deliverySlots(hours, before).some(slot => slot.startAt.startsWith("2026-10-08")));
  const boundary = new Date("2026-10-08T07:00:00.000Z");
  const start = deliverySlots(hours, boundary)[0]!;
  assert.equal(start.startAt, boundary.toISOString());
  assert.notEqual(deliverySlots(hours, new Date(boundary.getTime() + 1))[0]!.startAt, start.startAt);
  assert.throws(() => deliverySnapshot({ deliveryMode: "SCHEDULED", scheduledStartAt: start.startAt, scheduledEndAt: start.endAt }, hours, new Date(boundary.getTime() + 1)), /no longer available/);
});
test("next opening uses the actual weekday schedule rather than assuming tomorrow", () => {
  const afterClosing = new Date("2026-10-08T15:00:00Z");
  assert.equal(nextOpeningAt(hours, afterClosing), "2026-10-09T03:00:00.000Z");
  const weekend = hours.map(h => ({ ...h, isClosed: h.dayOfWeek === 5 || h.dayOfWeek === 6,
    opensAt: h.dayOfWeek === 0 ? "10:15" : h.opensAt }));
  assert.equal(nextOpeningAt(weekend, afterClosing), "2026-10-11T04:45:00.000Z");
  assert.equal(nextOpeningAt(hours.map(h => ({ ...h, isClosed: true })), afterClosing), null);
  assert.equal(shoppingAvailability(hours, afterClosing).scheduledDeliveryAvailable, true);
});
test("daily closure is independent of product availability and closes at the end boundary", () => {
  assert.equal(operatingStatus(hours, new Date("2026-10-08T03:00:00Z")), "OPEN");
  assert.equal(operatingStatus(hours, new Date("2026-10-08T14:45:00Z")), "CLOSED");
  assert.equal(operatingStatus([], now), "CLOSED");
});
test("Instant is default and cannot smuggle scheduled timestamps", () => {
  const input = { cartId: randomUUID(), addressId: randomUUID(), idempotencyKey: randomUUID(), paymentMethod: "COD" };
  assert.equal(customerOrderCreateSchema.parse(input).deliveryMode, "INSTANT");
  assert.equal(customerOrderCreateSchema.safeParse({ ...input, scheduledStartAt: now.toISOString() }).success, false);
  assert.equal(customerOrderCreateSchema.safeParse({ ...input, deliveryMode: "SCHEDULED" }).success, false);
  assert.deepEqual(deliverySnapshot({ deliveryMode: "INSTANT" }, hours, now),
    { deliveryMode: "INSTANT", scheduledStartAt: null, scheduledEndAt: null });
});
test("scheduled snapshot is frozen from a canonical slot; forged/past/mismatched slots are rejected", () => {
  const slot = deliverySlots(hours, now)[0]!;
  const snapshot = deliverySnapshot({ deliveryMode: "SCHEDULED", scheduledStartAt: slot.startAt, scheduledEndAt: slot.endAt }, hours, now);
  assert.equal(snapshot.scheduledStartAt!.toISOString(), slot.startAt);
  for (const [start, end] of [
    ["2026-10-08T01:00:00Z", "2026-10-08T02:00:00Z"],
    [slot.startAt, "2026-10-08T20:00:00Z"], ["invalid", "invalid"],
  ]) assert.throws(() => deliverySnapshot({ deliveryMode: "SCHEDULED", scheduledStartAt: start, scheduledEndAt: end }, hours, now), /no longer available/);
  hours[4]!.closesAt = "18:15";
  assert.equal(snapshot.scheduledEndAt!.toISOString(), slot.endAt);
  hours[4]!.closesAt = "20:15";
});
