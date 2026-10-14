import assert from "node:assert/strict";
import test from "node:test";
import { isPasswordOwner } from "@workspace/validation";
import { readFile } from "node:fs/promises";

test("password update ownership must match the authenticated user and the portal role", () => {
  for (const role of ["customer", "vendor", "delivery_partner", "admin"] as const) {
    assert.equal(isPasswordOwner({ userId: "owner", role }, "owner", role), true);
    assert.equal(isPasswordOwner({ userId: "other", role }, "owner", role), false);
    assert.equal(isPasswordOwner(undefined, "owner", role), false);
    assert.equal(isPasswordOwner({ userId: "owner", role }, undefined, role), false);
    for (const other of ["customer", "vendor", "delivery_partner", "admin"] as const)
      if (role !== other) assert.equal(isPasswordOwner({ userId: "owner", role: other }, "owner", role), false);
  }
});

test("Forgot Password shows password fields without identity inputs; saving verifies session and server role first", async () => {
  const [dashboard, customer, app, signup, registration] = await Promise.all([
    readFile(new URL("./AuthControls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../customer/src/components/AuthControls.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../customer/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("./VendorSignup.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../backend/api/src/auth/vendor-registration.ts", import.meta.url), "utf8"),
  ]);
  for (const [source, resetName, confirmationLabel] of [
    [dashboard, "export function ResetPassword", /role === "admin" \? "Re-enter New Password" : "Re-enter Password"/],
    [customer, "export function CustomerResetForm", /label=\{t\("Re-enter Password"\)\}/],
  ] as const) {
    const resetStart = source.indexOf(resetName);
    const recovery = source.slice(0, resetStart);
    const reset = source.slice(resetStart);
    assert.ok(resetStart > 0, `missing ${resetName}`);
    assert.match(recovery, confirmationLabel);
    assert.doesNotMatch(recovery, /supabase\.auth\.updateUser|value=\{identity\}|value=\{username\}/);
    assert.ok(reset.indexOf("isPasswordOwner(profile.auth") < reset.indexOf("supabase.auth.updateUser"));
    assert.match(reset, /current\.session\?\.access_token !== before\.session\.access_token/);
    assert.match(reset, /supabase\.auth\.signOut/);
  }
  assert.match(app, /CustomerRecoveryForm initialIdentity=\{legacyLogin \? username : mobileNumber\} identityType=\{legacyLogin \? "legacy" : "mobile"\}/);
  assert.match(signup, /input\("name", "Shop Name"/);
  assert.match(signup, /password !== confirmation/);
  assert.match(registration, /if \(retry\.rows\[0\]\)/);
  assert.ok(registration.indexOf("if (retry.rows[0])") < registration.indexOf("INSERT INTO stores"));
  assert.match(registration, /PENDING_APPROVAL',true/);
});
