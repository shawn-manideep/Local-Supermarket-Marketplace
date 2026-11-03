import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { customerLoginSchema, loginCustomer } from "./account-access.js";

const session = { userId: "customer-id", access_token: "fake-access", refresh_token: "fake-refresh" };
const failure = { statusCode: 401, message: "Invalid username or password." };

test("email login normalizes email, bypasses username mapping and returns only session tokens", async () => {
  const result = await loginCustomer("Person@Example.test", "unchanged", {
    identity: async () => { throw new Error("Email must not use username lookup"); },
  }, {
    signIn: async (id, password) => {
      assert.equal(id, session.userId);
      assert.equal(password, "unchanged");
      return session;
    },
  }, async email => {
    assert.equal(email, "person@example.test");
    return { id: session.userId, role: "customer", status: "ACTIVE" };
  }, async id => {
    assert.equal(id, session.userId);
    return true;
  });
  assert.deepEqual(result, { session: { access_token: "fake-access", refresh_token: "fake-refresh" } });
});

test("unknown, wrong-role and incorrect-password email logins have identical errors", async () => {
  for (const role of [undefined, "vendor", "admin", "delivery_partner", "customer"]) {
    let attempts = 0;
    await assert.rejects(loginCustomer("person@example.test", "wrong", {
      identity: async () => { throw new Error("Unexpected username lookup"); },
    }, {
      signIn: async id => {
        attempts++;
        assert.equal(id, role === "customer" ? session.userId : null);
        return null;
      },
    }, async () => role ? { id: session.userId, role } : undefined,
    async () => { throw new Error("No status lookup after rejected credentials"); }), failure);
    assert.equal(attempts, 1);
  }
});

test("both login methods reject inactive/deleted/role-changed accounts after authentication", async () => {
  for (const identifier of ["existing_user", "person@example.test"]) {
    await assert.rejects(loginCustomer(identifier, "password", {
      identity: async () => ({ id: session.userId, role: "customer" }),
    }, { signIn: async () => session },
    async () => ({ id: session.userId, role: "customer" }),
    async () => false), failure);
  }
});

test("email login rejects a different Auth UUID even when provider authentication succeeds", async () => {
  await assert.rejects(loginCustomer("person@example.test", "password", {
    identity: async () => undefined,
  }, { signIn: async () => ({ ...session, userId: "different" }) },
  async () => ({ id: session.userId, role: "customer" }),
  async () => { throw new Error("UUID mismatch must fail first"); }), failure);
});

test("invalid formats, extra role/ID fields and empty passwords fail before account lookup", async () => {
  for (const input of [
    { username: "bad@", password: "password" },
    { username: "person@example.test", password: "" },
    { username: "person@example.test", password: "password", role: "admin" },
    { username: "person@example.test", password: "password", userId: "other" },
  ]) assert.equal(customerLoginSchema.safeParse(input).success, false);
  await assert.rejects(loginCustomer("bad@", "password", {
    identity: async () => { throw new Error("No lookup permitted"); },
  }, { signIn: async () => { throw new Error("No provider call permitted"); } },
  async () => { throw new Error("No email lookup permitted"); }), failure);
});

test("email lookup is parameterized, bounded and rejects ambiguity; status recheck requires Customer role", async () => {
  const source = await readFile(new URL("./account-access.ts", import.meta.url), "utf8");
  const lookup = source.slice(source.indexOf("export async function findCustomerEmail"), source.indexOf("export async function loginCustomer"));
  assert.match(lookup, /lower\(u\.email\)=lower\(\$\{email\}\)/);
  assert.match(lookup, /LIMIT 2/);
  assert.match(lookup, /rows\.length === 1 \? result\.rows\[0\] : undefined/);
  assert.match(lookup, /c\.status='ACTIVE' AND p\.role='customer'/);
  assert.doesNotMatch(lookup, /sql\.raw|INSERT|UPDATE|DELETE|encrypted_password/);
});
