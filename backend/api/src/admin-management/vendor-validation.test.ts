import assert from "node:assert/strict";
import test from "node:test";
import { vendorProvisionSchema, vendorProfileUpdateSchema, vendorLoginSchema } from "@workspace/validation/vendor-profile";
import { storeUpdateSchema } from "@workspace/validation";

const input = {
  username: "Location_QA", password: "Synthetic_QA_A9", name: "Sri Lakshmi Supermarket", ownerName: "QA Owner",
  addressLine1: "Plot No. 12, Main Road", addressLine2: "Near Community Hall", locality: "Pragathi Nagar",
  city: "Hyderabad", state: "Telangana", pincode: "500090", phone: "9876543210", email: "owner@qa.invalid",
};
test("creation reuses global username normalization and accepted Indian contact validation", () => {
  const result = vendorProvisionSchema.parse(input);
  assert.equal(result.username, "location_qa");
  assert.equal(result.pincode, "500090");
  assert.equal(vendorProvisionSchema.safeParse({ ...input, email: null, phone: null }).success, true);
  assert.equal(vendorProvisionSchema.safeParse({ ...input, addressLine2: undefined }).success, true);
});
for (const field of ["name", "ownerName", "username", "password", "addressLine1", "locality", "city", "state", "pincode"] as const) {
  test(`creation rejects missing required ${field}`, () => {
    const { [field]: _ignored, ...missing } = input;
    assert.equal(vendorProvisionSchema.safeParse(missing).success, false);
    assert.equal(vendorProvisionSchema.safeParse({ ...input, [field]: "" }).success, false);
  });
}
for (const [field, value] of [
  ["username", "admin"], ["username", " abcd"], ["username", "1bad"], ["username", "ab"], ["username", "abc-xyz"],
  ["password", "short"], ["password", "a".repeat(129)], ["pincode", "050090"], ["pincode", "50009"],
  ["pincode", "5000900"], ["pincode", "ABCDE1"], ["phone", "123"], ["email", "invalid"], ["logoImageUrl", "not a URL"],
] as const) {
  test(`creation rejects invalid ${field} case ${value.slice(0, 14)}`, () => {
    assert.equal(vendorProvisionSchema.safeParse({ ...input, [field]: value }).success, false);
  });
}
test("creation and profile update reject role, identity, status and commercial write injection", () => {
  for (const field of ["role", "status", "id", "storeId", "ownerUserId", "price", "stock", "availability", "sku", "variants", "commissionRate"]) {
    assert.equal(vendorProvisionSchema.safeParse({ ...input, [field]: "ACTIVE" }).success, false);
    assert.equal(vendorProfileUpdateSchema.safeParse({ city: "Hyderabad", [field]: "ACTIVE" }).success, false);
  }
  for (const field of ["username", "password"]) {
    assert.equal(vendorProfileUpdateSchema.safeParse({ city: "Hyderabad", [field]: "other" }).success, false);
  }
  assert.equal(vendorProfileUpdateSchema.safeParse({}).success, false);
});
test("existing partial vendor store updates remain valid; location validates when provided", () => {
  assert.equal(storeUpdateSchema.safeParse({ name: "Updated shop" }).success, true);
  assert.equal(storeUpdateSchema.safeParse({ city: "Hyderabad", pincode: "500090" }).success, true);
  assert.equal(storeUpdateSchema.safeParse({ pincode: "000000" }).success, false);
  assert.equal(storeUpdateSchema.safeParse({ username: "other" }).success, false);
});
test("operating hours reuse existing rules and do not introduce a second hours model", () => {
  const valid = { dayOfWeek: 1, isClosed: false, opensAt: "09:00", closesAt: "21:00" };
  assert.equal(vendorProfileUpdateSchema.safeParse({ hours: [valid] }).success, true);
  assert.equal(vendorProfileUpdateSchema.safeParse({ hours: [{ dayOfWeek: 0, isClosed: true, opensAt: null, closesAt: null }] }).success, true);
  for (const hours of [
    [valid, valid], [{ ...valid, dayOfWeek: 7 }], [{ ...valid, closesAt: "08:00" }],
    [{ ...valid, opensAt: undefined }], [{ ...valid, isClosed: true }],
  ]) assert.equal(vendorProfileUpdateSchema.safeParse({ hours }).success, false);
});
test("vendor username login uses the existing shared rules; no alternate username registry", () => {
  assert.equal(vendorLoginSchema.parse({ username: "Location_QA", password: "synthetic" }).username, "location_qa");
  assert.equal(vendorLoginSchema.safeParse({ username: "bad name", password: "synthetic" }).success, false);
});
