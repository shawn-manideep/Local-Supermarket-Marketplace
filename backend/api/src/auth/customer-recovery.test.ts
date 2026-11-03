import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  recoveryGateway, recoveryInput, recoveryRedirect, requestRecovery, RECOVERY_MESSAGE,
  type RecoveryIdentity,
} from "./account-access.js";

const customer = { id: "fixture-customer", role: "customer", email: "registered@example.test" };
const dialect = new PgDialect();

test("Customer email and username recovery resolve through parameterized role-scoped lookups", async () => {
  for (const [identity, expected, predicate] of [
    ["Person@Example.test", "Person@Example.test", "lower(u.email)=lower("],
    ["Existing_User", "existing_user", "n.normalized_username="],
  ]) {
    let calls = 0;
    const gateway = recoveryGateway(async query => {
      calls++;
      const compiled = dialect.sqlToQuery(query);
      assert.ok(compiled.sql.includes(predicate));
      assert.ok(!compiled.sql.includes(identity));
      assert.ok(compiled.params.includes(expected));
      assert.ok(compiled.params.includes("customer"));
      assert.equal(compiled.params.at(-1), 2);
      return { rows: [customer] };
    });
    assert.deepEqual(await gateway.find({ role: "customer", identity }), customer);
    assert.equal(calls, 1);
  }
});

test("unknown or ambiguous Customer identities fail closed", async () => {
  for (const identity of ["person@example.test", "existing_user"]) {
    for (const rows of [[], [customer, { ...customer, id: "second" }]]) {
      const gateway = recoveryGateway(async () => ({ rows }));
      assert.equal(await gateway.find({ role: "customer", identity }), null);
    }
  }
});

test("mobile recovery still requires verified ownership and scopes the final Auth lookup", async () => {
  for (const verified of [false, true]) {
    let queries = 0;
    const gateway = recoveryGateway(async query => {
      queries++;
      const compiled = dialect.sqlToQuery(query);
      assert.match(compiled.sql, /phone_confirmed_at IS NOT NULL/);
      assert.ok(compiled.params.includes("fixture-customer"));
      assert.ok(compiled.params.includes("+919876543210"));
      return { rows: [customer] };
    }, async (phone, role) => {
      assert.equal(phone, "9876543210");
      assert.equal(role, "customer");
      return verified ? {
        id: customer.id, role: "customer", confirmed: true, customerStatus: "ACTIVE",
        storeId: null, storeStatus: null, partnerStatus: null,
      } : null;
    });
    assert.deepEqual(await gateway.find({ role: "customer", identity: "9876543210", identityType: "mobile" }),
      verified ? customer : null);
    assert.equal(queries, verified ? 1 : 0);
  }
});

test("invalid Customer recovery formats and injected redirect/role fields are rejected", async () => {
  for (const identity of ["", "bad@", "a b@example.test", "admin", "ab", "a".repeat(255)]) {
    assert.equal(recoveryInput.safeParse({ role: "customer", identity }).success, false);
    const gateway = recoveryGateway(async () => { throw new Error("No lookup for invalid input"); });
    assert.equal(await gateway.find({ role: "customer", identity }), null);
  }
  for (const identity of ["person@example.test", "existing_user", "1234", "+19876543210"]) {
    assert.equal(recoveryInput.safeParse({ role: "customer", identity, identityType: "mobile" }).success, false);
  }
  for (const extra of [{ redirectTo: "https://untrusted.invalid" }, { userId: "another" }]) {
    assert.equal(recoveryInput.safeParse({ role: "customer", identity: "person@example.test", ...extra }).success, false);
  }
});

test("email, username and mobile recovery return identical confirmations for every account/provider outcome", async () => {
  for (const [identity, identityType] of [
    ["person@example.test", "legacy"], ["existing_user", "legacy"], ["9876543210", "mobile"],
  ] as const) {
    for (const account of [customer, null, { ...customer, role: "vendor" },
      { ...customer, email: "placeholder@accounts.localbasket.invalid" }]) {
      for (const providerFails of [false, true]) {
        let sent = 0;
        const result = await requestRecovery({ role: "customer", identity, identityType }, "https://fixture.invalid/customer/", {
          find: async () => account,
          send: async email => {
            sent++;
            if (account === customer) assert.equal(email, customer.email);
            else assert.match(email, /^unknown-.*@accounts\.localbasket\.invalid$/);
            if (providerFails) throw new Error("private provider failure");
          },
        });
        assert.equal(sent, 1);
        assert.deepEqual(result, { message: RECOVERY_MESSAGE });
        assert.doesNotMatch(JSON.stringify(result), /fixture-customer|registered@example|private provider/);
      }
    }
    assert.deepEqual(await requestRecovery({ role: "customer", identity, identityType }, "", {
      find: async () => { throw new Error("private lookup failure"); },
      send: async () => { throw new Error("must not send after lookup failure"); },
    }), { message: RECOVERY_MESSAGE });
  }
});

test("other portal email/username lookup rules and native callback restrictions remain unchanged", async () => {
  for (const role of ["vendor", "admin", "delivery_partner"] as const) {
    let queries = 0;
    const gateway = recoveryGateway(async query => {
      queries++;
      const compiled = dialect.sqlToQuery(query);
      assert.ok(compiled.params.includes(role));
      assert.equal(compiled.params.at(-1), 1);
      return { rows: [{ ...customer, role } as RecoveryIdentity] };
    });
    const result = await gateway.find({ role, identity: "person@example.test" });
    assert.equal(queries, role === "delivery_partner" ? 0 : 1);
    assert.equal(result?.role ?? null, role === "delivery_partner" ? null : role);
    assert.equal(recoveryInput.safeParse({ role, identity: "existing_user", client: "customer_native" }).success, false);
  }
  assert.equal(recoveryRedirect("customer", "https://untrusted.invalid", "customer_native"),
    "apnalocalbasket-customer://auth/callback");
});
