import assert from "node:assert/strict";
import test from "node:test";
import { keepVendorProfile, isCurrentSessionFailure } from "./vendor-session";
import { readFile } from "node:fs/promises";
import { vendorRegistrationSchema } from "@workspace/validation/vendor-profile";
import { resetPasswordSchema } from "@workspace/validation";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("refresh and tab rerenders keep only the same Vendor identity; logout and account switches clear it", () => {
  const vendor = { userId: "vendor-1", role: "vendor" };
  assert.equal(keepVendorProfile(vendor, "vendor-1"), true);
  assert.equal(keepVendorProfile(vendor, undefined), false);
  assert.equal(keepVendorProfile(vendor, "vendor-2"), false);
  assert.equal(keepVendorProfile({ ...vendor, role: "customer" }, "vendor-1"), false);
  assert.equal(isCurrentSessionFailure("old-token", "new-token"), false);
  assert.equal(isCurrentSessionFailure("current-token", "current-token"), true);
});

test("registration requires real store fields and rejects status, document bypass and pricing assignments", () => {
  const valid = {
    username: "vendor_shop", name: "Corner Store", ownerName: "Store Owner",
    phone: "9876543210", addressLine1: "12 Market St", locality: "Market",
    city: "Hyderabad", state: "Telangana", pincode: "500001",
  };
  assert.equal(vendorRegistrationSchema.safeParse(valid).success, true);
  for (const forbidden of ["status", "documentsRequired", "deliveryFee", "role", "password"]) {
    assert.equal(vendorRegistrationSchema.safeParse({ ...valid, [forbidden]: "ACTIVE" }).success, false);
  }
  assert.equal(vendorRegistrationSchema.safeParse({ ...valid, ownerName: "" }).success, false);
  assert.equal(resetPasswordSchema.safeParse("short").success, false);
  assert.equal(resetPasswordSchema.safeParse("long-enough").success, true);
});

test("Vendor signup uses verified provider identity and pending store; recovery requires verified session", async () => {
  const [signup, server, routes, app, controls, vendor] = await Promise.all([
    read("./VendorSignup.tsx"), read("../../../backend/api/src/auth/vendor-registration.ts"),
    read("../../../backend/api/src/auth/routes.ts"), read("./App.tsx"),
    read("./AuthControls.tsx"), read("./VendorStorePanel.tsx"),
  ]);
  assert.match(signup, /supabase\.auth\.signUp/);
  assert.match(signup, /password !== confirmation/);
  assert.match(signup, /apiRequest\("\/api\/vendor\/register", session\.access_token/);
  assert.match(server, /isVerifiedVendorSignup\(data\.user, request\.auth\.userId\)/);
  assert.match(server, /FOR UPDATE OF p,c/);
  assert.match(server, /'PENDING_APPROVAL',true/);
  assert.match(routes, /"\/api\/vendor\/register", requireAuth\(\)/);
  assert.match(app, /keepVendorProfile\(vendorProfileRef\.current, nextSession\?\.user\.id\)/);
  assert.match(vendor, /hidden=\{currentTab !== "catalog"\}/);
  assert.match(controls, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(controls, /password !== confirmation/);
});
