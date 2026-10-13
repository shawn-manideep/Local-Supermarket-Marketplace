import assert from "node:assert/strict";
import test from "node:test";
import { isUnusedSignupShell, isVerifiedVendorSignup } from "./vendor-registration-guards.js";

test("only a matching, email-verified Vendor signup may complete onboarding", () => {
  const user = { id: "vendor-new", email_confirmed_at: "2026-10-13", user_metadata: { vendor_signup: true } };
  assert.equal(isVerifiedVendorSignup(user, user.id), true);
  assert.equal(isVerifiedVendorSignup(user, "another-id"), false);
  assert.equal(isVerifiedVendorSignup({ ...user, email_confirmed_at: null }, user.id), false);
  assert.equal(isVerifiedVendorSignup({ ...user, user_metadata: { vendor_signup: "true" } }, user.id), false);
});

test("operational accounts and already registered identities cannot be converted or registered again", () => {
  const shell = { role: "customer", status: "ACTIVE", username_id: null };
  assert.equal(isUnusedSignupShell(shell, false), true);
  assert.equal(isUnusedSignupShell(shell, true), false);
  assert.equal(isUnusedSignupShell({ ...shell, username_id: "existing" }, false), false);
  assert.equal(isUnusedSignupShell({ ...shell, role: "vendor" }, false), false);
  assert.equal(isUnusedSignupShell({ ...shell, role: "admin" }, false), false);
  assert.equal(isUnusedSignupShell({ ...shell, status: "INACTIVE" }, false), false);
  assert.equal(isUnusedSignupShell(undefined, false), false);
});
