import assert from "node:assert/strict";
import test from "node:test";
import {
  customerAddressCreateSchema,
  customerAddressUpdateSchema,
  customerProfileUpdateSchema,
} from "@workspace/validation";
import { addressWriteFields } from "./address-fields.js";

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

test("structured addresses require a nonblank house/flat while legacy requests remain valid", () => {
  const { line1, ...base } = validAddress;
  assert.equal(customerAddressCreateSchema.safeParse({ ...base, houseNumber: "Flat No. 302", buildingName: "Green Heights", landmark: "Near ABC School", locality: "Pragathi Nagar" }).success, true);
  assert.equal(customerAddressCreateSchema.safeParse(base).success, false);
  assert.equal(customerAddressCreateSchema.safeParse({ ...base, houseNumber: "  " }).success, false);
  assert.equal(customerAddressCreateSchema.safeParse({ ...base, houseNumber: "302", buildingName: null, landmark: null, locality: null }).success, true);
  assert.equal(customerAddressUpdateSchema.safeParse({ houseNumber: null }).success, false);
  assert.equal(customerAddressCreateSchema.safeParse({ ...base, line1 }).success, true);
});
test("new address mapping retains compatibility lines and optional clearing without duplication", () => {
  const input = { houseNumber: "302", buildingName: "Green Heights", landmark: "Near ABC School", locality: "Pragathi Nagar" };
  const mapped = addressWriteFields(input);
  assert.equal(mapped.line1, "302");
  assert.equal(mapped.line2, "Green Heights, Near ABC School, Pragathi Nagar");
  const cleared = addressWriteFields({ buildingName: null }, { ...mapped, locality: null });
  assert.equal(cleared.line2, "Near ABC School");
  assert.equal(cleared.locality, null);
  const legacy = { line1: "12 Market Road", line2: "Near library" };
  assert.deepEqual(addressWriteFields({ phone: "9876543210" } as typeof legacy & { phone: string }, legacy), { phone: "9876543210" });
  assert.equal(addressWriteFields({ landmark: "New landmark" }, legacy).locality, "Near library");
});