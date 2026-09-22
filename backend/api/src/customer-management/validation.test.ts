import assert from "node:assert/strict";
import test from "node:test";
import {
  customerAddressCreateSchema,
  customerAddressUpdateSchema,
  customerProfileUpdateSchema,
} from "@workspace/validation";

const validAddress = {
  recipientName: "Asha Sharma",
  phone: "9876543210",
  line1: "12 Market Road",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
};

test("customer profile updates reject role and identity fields", () => {
  assert.equal(customerProfileUpdateSchema.safeParse({}).success, false);
  assert.equal(customerProfileUpdateSchema.safeParse({ role: "admin" }).success, false);
  assert.equal(customerProfileUpdateSchema.safeParse({ customerId: crypto.randomUUID() }).success, false);
  assert.equal(customerProfileUpdateSchema.safeParse({ fullName: "Asha", phone: null }).success, true);
  assert.equal(customerProfileUpdateSchema.safeParse({ phone: "9876543210" }).success, true);
  assert.equal(customerProfileUpdateSchema.safeParse({ phone: "+919876543210" }).success, false);
  assert.equal(customerProfileUpdateSchema.safeParse({ phone: "98765abcde" }).success, false);
  assert.equal(customerProfileUpdateSchema.safeParse({ phone: "5876543210" }).success, false);
});

test("customer address schemas validate required fields and Indian pincode", () => {
  assert.equal(customerAddressCreateSchema.safeParse(validAddress).success, true);
  assert.equal(customerAddressCreateSchema.safeParse({ ...validAddress, phone: "919876543210" }).success, false);
  assert.equal(customerAddressCreateSchema.safeParse({ ...validAddress, phone: "98765432101" }).success, false);
  assert.equal(customerAddressCreateSchema.safeParse({ ...validAddress, pincode: "012345" }).success, false);
  assert.equal(customerAddressCreateSchema.safeParse({ ...validAddress, customerId: crypto.randomUUID() }).success, false);
  assert.equal(customerAddressUpdateSchema.safeParse({}).success, false);
  assert.equal(customerAddressUpdateSchema.safeParse({ isDefault: true }).success, true);
});