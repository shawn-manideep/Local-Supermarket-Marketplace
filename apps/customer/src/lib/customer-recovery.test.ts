import assert from "node:assert/strict";
import test from "node:test";
import { customerLoginIdentifierSchema, indianMobileSchema, RECOVERY_CONFIRMATION, usernameSchema } from "@workspace/validation";
import { requestAccountRecovery, setBaseUrl } from "@workspace/api-client-react";

test("Customer recovery accepts and normalizes email/username while preserving mobile and registration validation", () => {
  assert.equal(customerLoginIdentifierSchema.parse("Person@Example.test"), "person@example.test");
  assert.equal(customerLoginIdentifierSchema.parse("Existing_User"), "existing_user");
  assert.equal(indianMobileSchema.parse("9876543210"), "+919876543210");
  assert.equal(usernameSchema.safeParse("person@example.test").success, false);
  for (const value of ["", "bad@", "a b@example.test", "admin", "ab"]) {
    assert.equal(customerLoginIdentifierSchema.safeParse(value).success, false);
  }
  for (const value of ["person@example.test", "existing_user", "1234", "+19876543210"]) {
    assert.equal(indianMobileSchema.safeParse(value).success, false);
  }
});

test("Customer recovery client sends email/username/mobile with fixed native marker and consumes only generic confirmation", async () => {
  const original = globalThis.fetch;
  setBaseUrl("https://offline-fixture.invalid");
  try {
    for (const [identity, identityType] of [
      ["person@example.test", "legacy"], ["existing_user", "legacy"], ["+919876543210", "mobile"],
    ] as const) {
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(String(url), "https://offline-fixture.invalid/api/auth/recovery");
        assert.equal(options?.method, "POST");
        assert.deepEqual(JSON.parse(String(options?.body)), {
          role: "customer", identity, identityType, client: "customer_native",
        });
        return new Response(JSON.stringify({ message: RECOVERY_CONFIRMATION }), {
          status: 202, headers: { "Content-Type": "application/json" },
        });
      };
      const response = await requestAccountRecovery({ role: "customer", identity, identityType, client: "customer_native" });
      assert.deepEqual(response, { message: RECOVERY_CONFIRMATION });
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = original;
    setBaseUrl(null);
  }
});
