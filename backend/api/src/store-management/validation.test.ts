import assert from "node:assert/strict";
import test from "node:test";
import {
  commissionRateUpdateSchema,
  operatingHoursSchema,
  servicePincodeSchema,
  storeUpdateSchema,
} from "@workspace/validation";

test("accepts permitted store updates and rejects protected fields", () => {
  assert.equal(
    storeUpdateSchema.safeParse({
      name: "Fresh Basket",
      deliveryFee: "35.50",
      minimumOrderValue: 250,
      phone: "+91 9876543210",
    }).success,
    true,
  );
  assert.equal(
    storeUpdateSchema.safeParse({ status: "ACTIVE" }).success,
    false,
  );
  assert.equal(
    storeUpdateSchema.safeParse({ commissionRate: 10 }).success,
    false,
  );
});

test("validates Indian pincodes and commission rate boundaries", () => {
  assert.equal(servicePincodeSchema.safeParse({ pincode: "560001" }).success, true);
  assert.equal(servicePincodeSchema.safeParse({ pincode: "056001" }).success, false);
  assert.equal(servicePincodeSchema.safeParse({ pincode: "56001" }).success, false);
  assert.equal(commissionRateUpdateSchema.safeParse({ commissionRate: null }).success, true);
  assert.equal(commissionRateUpdateSchema.safeParse({ commissionRate: 100 }).success, true);
  assert.equal(commissionRateUpdateSchema.safeParse({ commissionRate: 100.01 }).success, false);
});

test("requires valid open-day times and clears times for closed days", () => {
  assert.equal(
    operatingHoursSchema.safeParse({
      isClosed: false,
      opensAt: "09:00",
      closesAt: "18:00",
    }).success,
    true,
  );
  assert.equal(
    operatingHoursSchema.safeParse({
      isClosed: false,
      opensAt: "18:00",
      closesAt: "09:00",
    }).success,
    false,
  );
  assert.equal(
    operatingHoursSchema.safeParse({
      isClosed: true,
      opensAt: "09:00",
      closesAt: null,
    }).success,
    false,
  );
  assert.equal(
    operatingHoursSchema.safeParse({
      isClosed: true,
      opensAt: null,
      closesAt: null,
    }).success,
    true,
  );
});