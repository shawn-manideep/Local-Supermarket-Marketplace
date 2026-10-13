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
  for (const source of [dashboard, customer]) {
    const beforeReset = source.split(source === dashboard ? "export function ResetPassword" : "export function CustomerResetForm")[0];
    assert.match(beforeReset, /Re-enter New Password/);
    assert.doesNotMatch(beforeReset, /supabase\.auth\.updateUser|value=\{identity\}|value=\{username\}/);
    assert.ok(source.indexOf("isPasswordOwner(profile.auth") < source.indexOf("supabase.auth.updateUser"));
    assert.match(source, /current\.session\?\.access_token !== before\.session\.access_token/);
    assert.match(source, /supabase\.auth\.signOut/);
  }
  assert.match(app, /CustomerRecoveryForm initialIdentity=\{username\}/);
  assert.match(signup, /input\("name", "Shop Name"/);
  assert.match(signup, /password !== confirmation/);
  assert.match(registration, /if \(retry\.rows\[0\]\)/);
  assert.ok(registration.indexOf("if (retry.rows[0])") < registration.indexOf("INSERT INTO stores"));
  assert.match(registration, /PENDING_APPROVAL',true/);
});
