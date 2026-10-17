import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { customerLoginSchema, loginCustomer, RECOVERY_MESSAGE, recoveryInput, recoveryRedirect, requestRecovery, type RecoveryGateway } from "./account-access.js";

test("Customer login reuses shared case normalization and rejects invalid credentials format", () => {
  assert.deepEqual(customerLoginSchema.parse({ username: "Existing_User", password: "unchanged" }), { username: "existing_user", password: "unchanged" });
  for (const username of ["ab", "customer", "username@gmail.com", " abc", "abc ", "42customer"])
    assert.equal(customerLoginSchema.safeParse({ username, password: "password" }).success, false);
});

test("Customer username login preserves the identity/password and returns only existing Supabase session tokens", async () => {
  const result = await loginCustomer("existing_user", "original-password", {
    identity: async username => { assert.equal(username, "existing_user"); return { id: "original-customer", role: "customer" }; },
  }, {
    signIn: async (id, password) => { assert.equal(id, "original-customer"); assert.equal(password, "original-password"); return { userId: id!, access_token: "test-access", refresh_token: "test-refresh" }; },
  });
  assert.deepEqual(result, { session: { access_token: "test-access", refresh_token: "test-refresh" } });
});

test("unknown Customer username and wrong password use the same generic failure", async () => {
  for (const identity of [undefined, { id: "original-customer", role: "customer" }]) {
    await assert.rejects(loginCustomer("someone", "wrong", { identity: async () => identity }, { signIn: async () => null }), { statusCode: 401, message: "Invalid username or password." });
  }
});

test("Vendor, Partner and Admin identities cannot authenticate into the Customer portal", async () => {
  for (const role of ["vendor", "delivery_partner", "admin"]) {
    await assert.rejects(loginCustomer("someone", "password", { identity: async () => ({ id: "other-role", role }) }, {
      signIn: async id => { assert.equal(id, null); return null; },
    }), { statusCode: 401, message: "Invalid username or password." });
  }
});

test("Customer login rejects a mismatched provider identity", async () => {
  await assert.rejects(loginCustomer("someone", "password", { identity: async () => ({ id: "original", role: "customer" }) }, { signIn: async () => ({ userId: "other", access_token: "test", refresh_token: "test" }) }), { statusCode: 401 });
});

test("all four roles have identical known/unknown recovery confirmations without contact/ID/token disclosure", async () => {
  for (const role of ["customer", "vendor", "delivery_partner", "admin"] as const) {
    for (const account of [null, { id: "private-user-id", role, email: "registered@example.test" }, { id: "other-id", role: "wrong-role", email: "other@example.test" }]) {
      let sent = 0;
      const gateway: RecoveryGateway = { find: async () => account, send: async (email, redirect) => {
        sent++; assert.equal(redirect, "https://portal.example.test/recovery");
        assert.equal(email, account?.role === role ? account.email : email);
        if (account?.role !== role) assert.match(email, /@accounts\.localbasket\.invalid$/);
      } };
      const outcome = await requestRecovery({ role, identity: "somebody" }, "https://portal.example.test/recovery", gateway);
      assert.equal(sent, 1);
      assert.deepEqual(outcome, { message: RECOVERY_MESSAGE });
      assert.doesNotMatch(JSON.stringify(outcome), /registered@example|other@example|private-user-id|other-id|token/i);
    }
  }
});

test("non-deliverable placeholder identities and provider failures do not leak account existence", async () => {
  const gateway: RecoveryGateway = {
    find: async () => ({ id: "partner-id", role: "delivery_partner", email: "partner-placeholder@accounts.localbasket.invalid" }),
    send: async email => { assert.notEqual(email, "partner-placeholder@accounts.localbasket.invalid"); throw new Error("private provider diagnostic"); },
  };
  assert.deepEqual(await requestRecovery({ role: "delivery_partner", identity: "partner_user" }, "https://example.test", gateway), { message: RECOVERY_MESSAGE });
});

test("recovery rejects role/redirect injection and uses artifact routes rather than a caller-supplied redirect", () => {
  assert.equal(recoveryInput.safeParse({ role: "superadmin", identity: "somebody" }).success, false);
  assert.equal(recoveryInput.safeParse({ role: "customer", identity: "somebody", redirectTo: "https://attacker.test" }).success, false);
  assert.equal(recoveryRedirect("customer", "https://portal.test"), "https://portal.test/customer/?recovery=1");
  assert.equal(recoveryRedirect("vendor", "https://portal.test"), "https://portal.test/vendor/login?recovery=1");
  assert.equal(recoveryRedirect("admin", "https://portal.test"), "https://portal.test/admin?recovery=1");
  assert.equal(recoveryRedirect("delivery_partner", "https://portal.test"), "https://portal.test/delivery/login?recovery=1");
});

test("HTTP recovery protects origins, throttles requests and keeps timing independent of provider delivery", async () => {
  const route = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  assert.match(route, /origins\.includes\(origin\)/);
  assert.match(route, /\+\+attempts\.count > 5/);
  assert.match(route, /void requestRecovery/);
  assert.match(route, /setTimeout\(resolve, 1200\)/);
  assert.match(route, /res\.status\(202\)\.json\(\{ message: RECOVERY_MESSAGE \}\)/);
  assert.doesNotMatch(route, /console\./);
});

test("native recovery is opt-in, Customer-only and never accepts arbitrary callbacks", () => {
  assert.equal(recoveryInput.safeParse({
    role: "customer", identity: "customer_user", client: "customer_native",
  }).success, true);
  for (const role of ["vendor", "delivery_partner", "admin"]) {
    assert.equal(recoveryInput.safeParse({ role, identity: "existing_user", client: "customer_native" }).success, false);
  }
  assert.equal(recoveryInput.safeParse({
    role: "customer", identity: "customer_user", client: "customer_native", redirectTo: "https://attacker.test",
  }).success, false);
  assert.equal(recoveryInput.safeParse({ role: "customer", identity: "customer_user", client: "untrusted" }).success, false);
  assert.equal(recoveryRedirect("customer", "https://ignored.test", "customer_native"), "apnalocalbasket-customer://auth/callback");
  assert.equal(recoveryRedirect("vendor", "https://portal.test"), "https://portal.test/vendor/login?recovery=1");
});
