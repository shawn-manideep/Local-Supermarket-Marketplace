import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { indianMobileSchema, mobileLoginSchema, portalResetPasswordSchema, resetPasswordSchema, isPasswordOwner } from "@workspace/validation";
import { loginMobile, verifiedMobileAccount, type MobileAccount, type MobileRole } from "./mobile-access.js";
import { recoveryInput, requestRecovery, RECOVERY_MESSAGE } from "./account-access.js";
import { createApp } from "../app.js";

const phone = "+919876543210";
function account(role: MobileRole = "customer", changes: Partial<MobileAccount> = {}): MobileAccount {
  return { id: `${role}-existing-id`, role, confirmed: true, customerStatus: role === "customer" ? "ACTIVE" : null,
    storeId: role === "vendor" ? "original-store" : null, storeStatus: role === "vendor" ? "ACTIVE" : null,
    partnerStatus: role === "delivery_partner" ? "ACTIVE" : null, ...changes };
}
function session(userId: string) { return { userId, access_token: "test-access", refresh_token: "test-refresh" }; }

test("Indian phone normalization accepts local/+91 formats and rejects other countries, punctuation and malformed numbers", () => {
  for (const value of ["9876543210", phone, ` ${phone} `]) assert.equal(indianMobileSchema.parse(value), phone);
  for (const value of ["919876543210", "09876543210", "+19876543210", "5876543210", "98765 43210", "98765-43210", "987654321", "98765432101", "", null])
    assert.equal(indianMobileSchema.safeParse(value).success, false, String(value));
  assert.equal(mobileLoginSchema.safeParse({ mobileNumber: phone, password: "password", role: "admin" }).success, false);
  assert.equal(mobileLoginSchema.safeParse({ mobileNumber: phone, password: "", username: "ignored" }).success, false);
});

test("all three mobile logins preserve the existing UUID/password and return only Supabase session tokens", async () => {
  for (const role of ["customer", "vendor", "delivery_partner"] as const) {
    const original = account(role);
    let lookups = 0;
    const outcome = await loginMobile(role, "9876543210", "unchanged-password", async canonical => {
      assert.equal(canonical, phone); lookups++; return [original];
    }, { signIn: async (id, password) => {
      assert.equal(id, original.id); assert.equal(password, "unchanged-password"); return session(id!);
    } });
    assert.deepEqual(outcome, { session: { access_token: "test-access", refresh_token: "test-refresh" } });
    assert.equal(lookups, 2);
    assert.equal(original.storeId, role === "vendor" ? "original-store" : null);
  }
});

test("unknown, unverified, duplicate and conflicting numbers use dummy sign-in and the identical failure", async () => {
  const cases = [[], [account("customer", { confirmed: false })], [account(), account("vendor")],
    [account(), account("customer", { id: "unverified-conflict", confirmed: false })]];
  for (const rows of cases) {
    let called = false;
    await assert.rejects(loginMobile("customer", phone, "password", async () => rows, {
      signIn: async id => { called = true; assert.equal(id, null); return null; },
    }), { statusCode: 401, message: "Invalid sign-in details." });
    assert.equal(called, true);
  }
});

test("cross-role and Admin identities cannot obtain a session for another portal", async () => {
  for (const requested of ["customer", "vendor", "delivery_partner"] as const) {
    for (const actual of ["customer", "vendor", "delivery_partner", "admin"]) {
      if (requested === actual) continue;
      await assert.rejects(loginMobile(requested, phone, "password", async () => [account("customer", { role: actual })], {
        signIn: async id => { assert.equal(id, null); return null; },
      }), { statusCode: 401 });
    }
  }
  assert.equal(await verifiedMobileAccount(phone, "admin" as MobileRole, async () => [account("customer", { role: "admin" })]), null);
});

test("orphan or incomplete application profiles never become mobile identities", async () => {
  for (const [role, row] of [
    ["customer", account("customer", { customerStatus: null })],
    ["vendor", account("vendor", { storeId: null })],
    ["delivery_partner", account("delivery_partner", { partnerStatus: null })],
    ["customer", account("customer", { role: null })],
  ] as const) assert.equal(await verifiedMobileAccount(phone, role, async () => [row]), null);
});

test("wrong password and a mismatched provider UUID are rejected", async () => {
  for (const result of [null, session("different-account")]) {
    await assert.rejects(loginMobile("customer", phone, "wrong", async () => [account()], { signIn: async () => result }),
      { statusCode: 401, message: "Invalid sign-in details." });
  }
});

test("mapping, confirmation or role changes during password authentication fail closed", async () => {
  for (const changed of [[], [account("customer", { confirmed: false })], [account("customer", { id: "replacement" })], [account("vendor")]]) {
    let lookup = 0;
    await assert.rejects(loginMobile("customer", phone, "password", async () => ++lookup === 1 ? [account()] : changed,
      { signIn: async id => session(id!) }), { statusCode: 401 });
  }
});

test("Customer/Partner inactivity and Vendor suspension are checked only after password authentication", async () => {
  const scenarios = [
    ["customer", account("customer", { customerStatus: "INACTIVE" }), "CUSTOMER_INACTIVE"],
    ["vendor", account("vendor", { storeStatus: "SUSPENDED" }), "STORE_SUSPENDED"],
    ["delivery_partner", account("delivery_partner", { partnerStatus: "INACTIVE" }), "PARTNER_INACTIVE"],
  ] as const;
  for (const [role, row, code] of scenarios) {
    await assert.rejects(loginMobile(role, phone, "wrong", async () => [row], { signIn: async () => null }), { statusCode: 401 });
    await assert.rejects(loginMobile(role, phone, "correct", async () => [row], { signIn: async id => session(id!) }),
      { statusCode: 403, code });
  }
});

test("pending/rejected Vendors may authenticate for onboarding without changing catalog approval gates", async () => {
  for (const status of ["PENDING_APPROVAL", "REJECTED"]) {
    const result = await loginMobile("vendor", phone, "password", async () => [account("vendor", { storeStatus: status })],
      { signIn: async id => session(id!) });
    assert.ok(result.session.access_token);
  }
  const gate = await readFile(new URL("../vendor-documents/service.ts", import.meta.url), "utf8");
  assert.match(gate, /canManageCatalog: Boolean\(store\.complianceApproved\)/);
});

test("mobile identity queries exclude every editable contact field, and contain no account/data writes", async () => {
  const source = await readFile(new URL("./mobile-access.ts", import.meta.url), "utf8");
  assert.match(source, /FROM auth\.users u/);
  assert.match(source, /u\.phone_confirmed_at IS NOT NULL/);
  assert.match(source, /WHERE u\.phone IN/);
  assert.match(source, /LIMIT 2/);
  assert.doesNotMatch(source, /c\.phone|s\.phone|contact_number|recipient_phone|INSERT INTO|UPDATE |DELETE FROM|createUser|signUp|updateUser/);
});

test("mobile recovery is explicit, rejects Admin/redirect injection and retains legacy recovery compatibility", async () => {
  assert.equal(recoveryInput.safeParse({ role: "customer", identity: phone, identityType: "mobile" }).success, true);
  assert.equal(recoveryInput.safeParse({ role: "vendor", identity: "9876543210", identityType: "mobile" }).success, true);
  for (const input of [
    { role: "admin", identity: phone, identityType: "mobile" },
    { role: "customer", identity: "username", identityType: "mobile" },
    { role: "customer", identity: phone, identityType: "mobile", redirectTo: "https://attacker.test" },
  ]) assert.equal(recoveryInput.safeParse(input).success, false);
  assert.equal(recoveryInput.safeParse({ role: "admin", identity: "admin@example.test" }).success, true);
  for (const found of [null, { id: "existing", role: "customer", email: "recovery@example.test" }]) {
    const result = await requestRecovery({ role: "customer", identity: phone, identityType: "mobile" }, "https://portal.test/customer/",
      { find: async input => { assert.equal(input.identityType, "mobile"); return found; }, send: async () => {} });
    assert.deepEqual(result, { message: RECOVERY_MESSAGE });
  }
  const source = await readFile(new URL("./account-access.ts", import.meta.url), "utf8");
  assert.match(source, /verifiedMobileAccount\(input\.identity, input\.role\)/);
  assert.match(source, /u\.phone_confirmed_at IS NOT NULL/);
});

test("non-Admin password strength requires eight characters, a letter and a number; Admin rules remain unchanged", () => {
  for (const weak of ["short1", "abcdefgh", "12345678"]) assert.equal(portalResetPasswordSchema.safeParse(weak).success, false);
  for (const good of ["Password1", "తెలుగుపదం1"]) assert.equal(portalResetPasswordSchema.safeParse(good).success, true);
  assert.equal(resetPasswordSchema.safeParse("abcdefgh").success, true);
  assert.equal(isPasswordOwner(undefined, "id", "customer"), false);
  assert.equal(isPasswordOwner({ userId: "other", role: "customer" }, "id", "customer"), false);
  assert.equal(isPasswordOwner({ userId: "id", role: "vendor" }, "id", "customer"), false);
  assert.equal(isPasswordOwner({ userId: "id", role: "customer" }, "id", "customer"), true);
});

test("real mobile routes reject role injection and share existing login throttling without contacting Supabase", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const portal of ["customer", "vendor", "delivery-partner"]) {
      for (let index = 0; index < 10; index++) {
        const result = await fetch(`${base}/api/${portal}/mobile-login`, { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mobileNumber: phone, password: "password", role: "admin" }) });
        assert.equal(result.status, 401);
        assert.equal(result.headers.get("cache-control"), "no-store");
        assert.deepEqual(await result.json(), { error: "Invalid sign-in details." });
      }
      const result = await fetch(`${base}/api/${portal}/mobile-login`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.equal(result.status, 429);
      assert.ok(result.headers.get("retry-after"));
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
