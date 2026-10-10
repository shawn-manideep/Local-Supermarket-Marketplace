import assert from "node:assert/strict";
import test from "node:test";
import { customerCheckoutValidationSchema, customerOrderCreateSchema, handlingFeeSchema, storeUpdateSchema } from "@workspace/validation";
import { cartPricing } from "./pricing.js";
import { deliverySlots, deliverySnapshot } from "../orders/orderability.js";

test("handling fee accepts zero and exact decimal money; malformed or negative inputs fail", () => {
  for (const value of [0, 5.25, "0", "0.00", "5.25", "1000000", " 12.50 "]) assert.equal(handlingFeeSchema.safeParse(value).success, true);
  for (const value of [-1, "-0.01", "", "abc", "₹5", "1e2", "1,000", "1.234", 0.001, 0.000000001, null, false, Infinity, NaN, 1000000.01]) {
    assert.equal(handlingFeeSchema.safeParse(value).success, false, String(value));
    assert.equal(storeUpdateSchema.safeParse({ handlingFee: value }).success, false, String(value));
  }
});
test("cart pricing uses server-owned fees and integer cents with a zero default", () => {
  assert.deepEqual(cartPricing(25000n, { deliveryFee: "30.00", handlingFee: "5.00" }),
    { subtotal: "250.00", deliveryFee: "30.00", handlingFee: "5.00", total: "285.00" });
  assert.equal(cartPricing(30n, { deliveryFee: "0.10", handlingFee: "0.20" }).total, "0.60");
  assert.equal(cartPricing(25000n, { deliveryFee: "30.00" }).total, "280.00");
  assert.equal(cartPricing(0n, { deliveryFee: "0", handlingFee: "0" }).handlingFee, "0.00");
  assert.throws(() => cartPricing(-1n, { deliveryFee: "0", handlingFee: "0" }), /Invalid order pricing/);
  assert.throws(() => cartPricing(999999999999n, { deliveryFee: "0", handlingFee: "0.01" }), /Invalid order pricing/);
});
test("checkout and creation reject client-owned fees, prices and totals", () => {
  const addressId = crypto.randomUUID(), idempotencyKey = crypto.randomUUID(), cartId = crypto.randomUUID();
  const checkout = { addressId, paymentMethod: "COD" };
  const order = { ...checkout, cartId, idempotencyKey };
  assert.equal(customerCheckoutValidationSchema.safeParse(checkout).success, true);
  assert.equal(customerOrderCreateSchema.safeParse(order).success, true);
  for (const field of ["handlingFee", "handlingFeeSnapshot", "deliveryFee", "subtotal", "total", "totalAmount"]) {
    assert.equal(customerCheckoutValidationSchema.safeParse({ ...checkout, [field]: 1 }).success, false);
    assert.equal(customerOrderCreateSchema.safeParse({ ...order, [field]: 1 }).success, false);
  }
});
const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: "09:00", closesAt: "18:00" }));
test("today and tomorrow contain only complete future one-hour India-time slots", () => {
  const now = new Date("2026-10-10T10:15:00+05:30");
  const slots = deliverySlots(hours, now);
  assert.deepEqual([...new Set(slots.map(slot => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(slot.startAt))))].length, 2);
  assert.equal(slots[0].startAt, new Date("2026-10-10T11:00:00+05:30").toISOString());
  for (const slot of slots) {
    assert.ok(Date.parse(slot.startAt) > now.getTime());
    assert.equal(Date.parse(slot.endAt) - Date.parse(slot.startAt), 3600000);
  }
});
test("no eligible slot today falls forward to tomorrow; expired or malformed windows are rejected", () => {
  const now = new Date("2026-10-10T17:15:00+05:30");
  const slots = deliverySlots(hours, now);
  assert.equal(slots[0].startAt, new Date("2026-10-11T09:00:00+05:30").toISOString());
  assert.throws(() => deliverySnapshot({ deliveryMode: "SCHEDULED", scheduledStartAt: "2026-10-10T11:30:00.000Z", scheduledEndAt: "2026-10-10T12:30:00.000Z" }, hours, now));
  assert.throws(() => deliverySnapshot({ deliveryMode: "SCHEDULED", scheduledStartAt: slots[0].startAt, scheduledEndAt: new Date(Date.parse(slots[0].endAt) + 60000).toISOString() }, hours, now));
  assert.equal(deliverySlots(hours.map(hour => ({ ...hour, isClosed: true })), now).length, 0);
});
