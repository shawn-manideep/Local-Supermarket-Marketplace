import assert from "node:assert/strict";
import test from "node:test";
import { customerLoginIdentifierSchema, customerLoginSchema, usernameSchema, partnerLoginSchema } from "@workspace/validation";
import { loginCustomerUsername, setBaseUrl } from "@workspace/api-client-react";

test("Customer login accepts normalized usernames and email addresses in the existing payload", () => {
  for (const [input, expected] of [["Existing_User", "existing_user"], ["Person@Example.test", "person@example.test"]]) {
    assert.equal(customerLoginIdentifierSchema.parse(input), expected);
    assert.deepEqual(customerLoginSchema.parse({ username: input, password: "unchanged" }),
      { username: expected, password: "unchanged" });
  }
});

test("Customer login rejects invalid identifiers and does not relax registration or other portals", () => {
  for (const input of ["", "ab", "a@", "@example.test", "a b@example.test", " admin", "admin", "42user", "a".repeat(255)]) {
    assert.equal(customerLoginIdentifierSchema.safeParse(input).success, false, input);
  }
  assert.equal(usernameSchema.safeParse("person@example.test").success, false);
  assert.equal(partnerLoginSchema.safeParse({ username: "person@example.test", password: "password" }).success, false);
});

test("generated Customer client sends either identifier to the same API endpoint with no privileged key", async () => {
  const originalFetch = globalThis.fetch;
  setBaseUrl("https://offline-fixture.invalid");
  try {
    for (const username of ["existing_user", "person@example.test"]) {
      let calls = 0;
      globalThis.fetch = async (input, init) => {
        calls++;
        assert.equal(String(input), "https://offline-fixture.invalid/api/customer/login");
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), { username, password: "fake-password" });
        assert.equal(new Headers(init?.headers).has("apikey"), false);
        return new Response(JSON.stringify({ session: { access_token: "fake-access", refresh_token: "fake-refresh" } }),
          { headers: { "Content-Type": "application/json" } });
      };
      const result = await loginCustomerUsername({ username, password: "fake-password" });
      assert.deepEqual(result.session, { access_token: "fake-access", refresh_token: "fake-refresh" });
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
    setBaseUrl(null);
  }
});
