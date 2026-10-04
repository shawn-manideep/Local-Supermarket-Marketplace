import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import { usernameSchema, partnerProvisionSchema, partnerStatusSchema, RESERVED_USERNAMES } from "@workspace/validation";
import { requireDeliveryPartner } from "./middleware.js";
import type { PartnerRecord } from "./repository.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { createApp } from "../app.js";
const APP_ROLES = ["customer", "vendor", "admin", "delivery_partner"] as const;

test("Delivery Partner has its own distinct application role", async () => {
  const roles = await readFile(new URL("../../../../packages/shared-types/src/index.ts", import.meta.url), "utf8");
  assert.match(roles, /"customer", "vendor", "admin", "delivery_partner"/);
  assert.ok(APP_ROLES.includes("delivery_partner"));
  assert.equal(new Set(APP_ROLES).size, 4);
});
test("approved ASCII usernames normalize case, not invalid whitespace or punctuation", () => {
  for (const username of ["abc", "shar", "Sharanya", "sharanya1", "sharanya_1", "vendor123"])
    assert.equal(usernameSchema.parse(username), username.toLowerCase());
  for (const username of ["ab", "a".repeat(31), "12sharanya", "sharanya name", "sharanya-name", "sharanya@gmail.com", "@sharanya", " abc", "abc ", "sháranya", "日本語", "аbc"])
    assert.equal(usernameSchema.safeParse(username).success, false, username);
});
test("small reserved-name list is case insensitive", () => {
  for (const username of RESERVED_USERNAMES) {
    assert.equal(usernameSchema.safeParse(username).success, false);
    assert.equal(usernameSchema.safeParse(username.toUpperCase()).success, false);
  }
});
test("provisioning validates status/password/contact and rejects ownership or role input", () => {
  const valid = { username: "partner_test", password: "TestPassword12!", displayName: "Test Partner", contactNumber: "9876543210", status: "ACTIVE" };
  assert.equal(partnerProvisionSchema.safeParse(valid).success, true);
  for (const invalid of [{ ...valid, password: "short" }, { ...valid, role: "admin" }, { ...valid, userId: crypto.randomUUID() }, { ...valid, status: "PENDING" }, { ...valid, contactNumber: "bad" }])
    assert.equal(partnerProvisionSchema.safeParse(invalid).success, false);
  assert.equal(partnerStatusSchema.safeParse({ status: "INACTIVE", username: "new_name" }).success, false);
});
test("partner middleware denies every other role and inactive/missing profiles at the API boundary", async () => {
  for (const role of APP_ROLES) for (const status of ["ACTIVE", "INACTIVE", "MISSING"]) {
    let reads = 0;
    const serverApp = express();
    serverApp.get("/test", requireDeliveryPartner((req, _res, next) => {
      (req as AuthenticatedRequest).auth = { userId: "own-identity", role, storeId: null }; next();
    }, async id => {
      reads++; assert.equal(id, "own-identity");
      return status === "MISSING" ? undefined : { status } as PartnerRecord;
    }), (_req, res) => res.json({ ok: true }));
    const server = serverApp.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/test?partnerId=somebody-else`);
      assert.equal(response.status, role === "delivery_partner" && status === "ACTIVE" ? 200 : 403);
      assert.equal(reads, role === "delivery_partner" ? 1 : 0);
      assert.equal(response.headers.get("cache-control"), "no-store");
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
test("partner and admin provisioning routes reject unauthenticated requests", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    for (const path of ["/api/delivery-partner/me", "/api/delivery-partner/dashboard", "/api/delivery-partner/deliveries", "/api/admin/delivery-partners"]) {
      assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 401);
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/delivery-partners`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/delivery-partner/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("migration and registry never contain password storage or mutate historical inventory/order data", async () => {
  const migration = await readFile(new URL("../../../../database/migrations/0013_delivery_partner_foundation.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /password|UPDATE public\.orders|UPDATE public\.product_variants|UPDATE public\.order_items|ALTER TABLE public\.orders/);
  assert.match(migration, /normalized_username text NOT NULL UNIQUE/);
  assert.match(migration, /Username identity is immutable/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(migration, /partner_user_id = auth\.uid\(\) AND public\.is_active_delivery_partner\(\)/);
});
test("all partner queries use server identity; no assignment mutations or global marketplace order reads", async () => {
  const routes = await readFile(new URL("./routes.ts", import.meta.url), "utf8");
  const repo = await readFile(new URL("./repository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(routes, /req\.(body|query)\.partnerId|ordersRouter|status: "OUT_FOR_DELIVERY"|status: "DELIVERED"/);
  assert.match(repo, /WHERE a\.partner_user_id=\$\{id\} AND p\.status='ACTIVE'/g);
  assert.doesNotMatch(repo, /INSERT INTO delivery_assignments|UPDATE orders|FROM orders|JOIN customers|delivery_address_snapshot/);
  assert.match(routes, /requireRole\("admin"\)/g);
});