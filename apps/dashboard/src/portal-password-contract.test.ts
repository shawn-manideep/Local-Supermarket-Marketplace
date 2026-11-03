import assert from "node:assert/strict";
import test from "node:test";
import { loginCustomerUsername, loginVendorUsername, signInDeliveryPartner } from "../../../lib/api-client-react/src/generated/api";
import { setBaseUrl } from "../../../lib/api-client-react/src/custom-fetch";

test("generated clients send username/email password payloads to the correct portal endpoint", async () => {
  const original = globalThis.fetch;
  setBaseUrl("https://offline-fixture.invalid");
  try {
    for (const [login, path] of [
      [loginCustomerUsername, "/api/customer/login"],
      [loginVendorUsername, "/api/vendor/login"],
      [signInDeliveryPartner, "/api/delivery-partner/login"],
    ] as const) {
      for (const username of ["existing_user", "person@example.test"]) {
        let attempts = 0;
        globalThis.fetch = async (url, options) => {
          attempts++;
          assert.equal(String(url), `https://offline-fixture.invalid${path}`);
          assert.equal(options?.method, "POST");
          assert.deepEqual(JSON.parse(String(options?.body)), { username, password: "fake-password" });
          assert.equal(new Headers(options?.headers).has("apikey"), false);
          return new Response(JSON.stringify({ session: { access_token: "fake-access", refresh_token: "fake-refresh" } }),
            { headers: { "Content-Type": "application/json" } });
        };
        assert.deepEqual(await login({ username, password: "fake-password" }),
          { session: { access_token: "fake-access", refresh_token: "fake-refresh" } });
        assert.equal(attempts, 1);
      }
    }
  } finally {
    globalThis.fetch = original;
    setBaseUrl(null);
  }
});
