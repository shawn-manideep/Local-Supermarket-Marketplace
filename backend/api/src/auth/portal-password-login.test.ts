import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { getDb } from "@workspace/db";
import { portalLoginSchema, partnerProvisionSchema } from "@workspace/validation";
import { vendorLoginSchema } from "@workspace/validation/vendor-profile";
import { loginVendor } from "../admin-management/vendor-profile.js";
import { loginPartner, type PartnerAuthGateway } from "../delivery-partner/auth-service.js";
import type { PartnerRepository } from "../delivery-partner/repository.js";
import { findPasswordEmail, resolvePasswordIdentity } from "./password-identity.js";

const dialect = new PgDialect();
const invalid = { statusCode: 401, message: "Invalid username or password." };
type Role = "vendor" | "delivery_partner";
function fixture(role: Role, options: { found?: boolean; identityRole?: string; status?: string; mismatch?: boolean } = {}) {
  const identity = options.found === false ? undefined : { id: "fixture-id", role: options.identityRole ?? role };
  const queries: { sql: string; params: unknown[] }[] = [];
  const db = {
    execute: async (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
      queries.push(dialect.sqlToQuery(query));
      return { rows: identity ? [identity] : [] };
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ status: options.status ?? "ACTIVE" }] }) }) }),
  } as unknown as ReturnType<typeof getDb>;
  const repo = {
    identity: async (username: string) => { assert.equal(username, "existing_user"); return identity; },
    profile: async (id: string) => { assert.equal(id, "fixture-id"); return { status: options.status ?? "ACTIVE" }; },
  } as unknown as PartnerRepository;
  const attempts: (string | null)[] = [];
  const auth = {
    signIn: async (id: string | null, password: string) => {
      attempts.push(id);
      return id && password === "correct" ? {
        userId: options.mismatch ? "other-id" : id, access_token: "fake-access", refresh_token: "fake-refresh",
      } : null;
    },
  } as PartnerAuthGateway;
  return {
    queries, attempts,
    login: (identifier: string, password = "correct") => role === "vendor"
      ? loginVendor(identifier, password, db, auth)
      : loginPartner(repo, auth, identifier, password, email => findPasswordEmail(email, role, db)),
  };
}

for (const role of ["vendor", "delivery_partner"] as const) {
  for (const identifier of ["Existing_User", "Person@Example.test"]) {
    test(`${role}: ${identifier.includes("@") ? "email" : "username"} resolves existing identity and returns only tokens`, async () => {
      const f = fixture(role);
      assert.deepEqual(await f.login(identifier), { session: { access_token: "fake-access", refresh_token: "fake-refresh" } });
      assert.deepEqual(f.attempts, ["fixture-id"]);
      if (identifier.includes("@")) {
        assert.ok(f.queries[0].params.includes("person@example.test"));
        assert.ok(f.queries[0].params.includes(role));
        assert.match(f.queries[0].sql, /LIMIT 2/);
        assert.ok(!f.queries[0].sql.includes("person@example.test"));
      }
    });
    test(`${role}: ${identifier.includes("@") ? "email" : "username"} rejects wrong passwords, unknown accounts, cross-role accounts and UUID mismatches`, async () => {
      await assert.rejects(fixture(role).login(identifier, "incorrect"), invalid);
      const unknown = fixture(role, { found: false });
      await assert.rejects(unknown.login(identifier), invalid);
      assert.deepEqual(unknown.attempts, [null]);
      for (const identityRole of ["customer", "admin", role === "vendor" ? "delivery_partner" : "vendor"]) {
        const wrongRole = fixture(role, { identityRole });
        await assert.rejects(wrongRole.login(identifier), invalid);
        assert.deepEqual(wrongRole.attempts, [null]);
      }
      await assert.rejects(fixture(role, { mismatch: true }).login(identifier), invalid);
    });
    test(`${role}: ${identifier.includes("@") ? "email" : "username"} preserves post-password inactive/suspended checks`, async () => {
      const f = fixture(role, { status: role === "vendor" ? "SUSPENDED" : "INACTIVE" });
      await assert.rejects(f.login(identifier), { statusCode: 403, code: role === "vendor" ? "STORE_SUSPENDED" : "PARTNER_INACTIVE" });
      await assert.rejects(f.login(identifier, "incorrect"), invalid);
    });
  }
}

test("Vendor pending onboarding remains available without bypassing suspended-store checks", async () => {
  assert.ok((await fixture("vendor", { status: "PENDING_APPROVAL" }).login("existing_user")).session);
});

test("email ambiguity fails closed, identifiers are validated before lookup, and provisioning remains username-only", async () => {
  const ambiguous = { execute: async () => ({ rows: [{ id: "a", role: "vendor" }, { id: "b", role: "vendor" }] }) } as unknown as ReturnType<typeof getDb>;
  assert.equal(await findPasswordEmail("person@example.test", "vendor", ambiguous), undefined);
  for (const identifier of ["bad@", "", "admin", "ab", "a".repeat(255)]) {
    assert.equal(await resolvePasswordIdentity(identifier,
      async () => { throw new Error("No username lookup permitted"); },
      async () => { throw new Error("No email lookup permitted"); }), undefined);
  }
  for (const schema of [portalLoginSchema, vendorLoginSchema]) {
    for (const username of ["existing_user", "person@example.test"]) {
      assert.equal(schema.safeParse({ username, password: "correct" }).success, true);
      assert.equal(schema.safeParse({ username, password: "" }).success, false);
      assert.equal(schema.safeParse({ username, password: "correct", role: "admin" }).success, false);
    }
  }
  assert.equal(partnerProvisionSchema.shape.username.safeParse("person@example.test").success, false);
});
