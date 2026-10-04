import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "@workspace/db";
import { createApp } from "../app.js";
import { getSupabasePublicConfig } from "../auth/config.js";
type WireOutcome = {
  auth: { role: string };
  partner: { id: string; username: string };
  session: { access_token: string; refresh_token: string };
  summary: Record<string, number>;
  deliveries: unknown[];
  code: string;
  error: string;
};
const payload = (response: Response) => response.json() as Promise<WireOutcome>;

// Explicitly opt in to TEMPORARY identities in the confirmed development project.
// No orders, stock, assignments, existing accounts, or production data are changed.
test("development Supabase Auth and actual HTTP APIs: partner provisioning/login/isolation and legacy email sessions", {
  skip: process.env.RUN_PHASE6_AUTH_INTEGRATION !== "1",
  timeout: 120_000,
}, async t => {
  const config = getSupabasePublicConfig();
  assert.equal(new URL(config.SUPABASE_URL).hostname, "gkwcolipeavxnuzqlamb.supabase.co", "Refuse non-development target");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(key, "Development Auth service must be configured");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const adminAuth = createClient(config.SUPABASE_URL, key, options);
  const db = getDb(), ids = new Set<string>();
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const password = () => `${randomBytes(18).toString("base64url")}_Aa9`;
  const username = () => `p6_${randomBytes(7).toString("hex")}`;
  const request = (path: string, token = "", method = "GET", body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    const tokens = new Map<string, string>();
    for (const role of ["customer", "vendor", "admin"]) {
      const email = `p6-${randomUUID()}@test.localbasket.invalid`, secret = password();
      const created = await adminAuth.auth.admin.createUser({ email, password: secret, email_confirm: true });
      assert.equal(created.error, null, "Temporary identity creation failed");
      const id = created.data.user!.id; ids.add(id);
      await db.execute(sql`UPDATE user_profiles SET role=${role}::app_role WHERE id=${id}`);
      const auth = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, options);
      const signedIn = await auth.auth.signInWithPassword({ email, password: secret });
      assert.equal(signedIn.error, null, `Existing ${role} email/password mechanism failed`);
      tokens.set(role, signedIn.data.session!.access_token);
      await t.test(`existing ${role} email session resolves its authoritative role`, async () => {
        const response = await request("/api/auth/me", tokens.get(role));
        assert.equal(response.status, 200);
        assert.equal((await payload(response)).auth.role, role);
      });
    }
    const adminToken = tokens.get("admin")!;
    const partnerInput = { username: username(), password: password(), displayName: "Temporary Delivery Test", contactNumber: null, status: "ACTIVE" };
    const created = await request("/api/admin/delivery-partners", adminToken, "POST", partnerInput);
    assert.equal(created.status, 201, "Admin provisioning failed");
    const a = (await payload(created)).partner; ids.add(a.id);
    await t.test("admin response never includes password or technical Auth email", () => {
      assert.equal("password" in a, false); assert.equal("email" in a, false);
      assert.equal(a.username, partnerInput.username);
    });
    const secondInput = { ...partnerInput, username: username(), password: password() };
    const second = await request("/api/admin/delivery-partners", adminToken, "POST", secondInput);
    assert.equal(second.status, 201);
    const b = (await payload(second)).partner; ids.add(b.id);
    const signIn = await request("/api/delivery-partner/login", "", "POST", { username: partnerInput.username.toUpperCase(), password: partnerInput.password });
    assert.equal(signIn.status, 200, "Username/password Supabase login failed");
    const session = (await payload(signIn)).session;
    assert.ok(session.access_token && session.refresh_token);
    const partnerToken = session.access_token;
    await t.test("active partner has own profile, correct empty dashboard and no delivery records", async () => {
      const me = await request(`/api/delivery-partner/me?partnerId=${b.id}`, partnerToken);
      assert.equal(me.status, 200);
      const own = (await payload(me)).partner;
      assert.equal(own.username, a.username);
      assert.equal("id" in own, false);
      const dashboard = await request("/api/delivery-partner/dashboard", partnerToken);
      assert.equal(dashboard.status, 200);
      assert.deepEqual((await payload(dashboard)).summary, { total: 0, pending: 0, assigned: 0, inProgress: 0, completed: 0, cancelled: 0, rejected: 0, accepted: 0, pickedUp: 0, outForDelivery: 0, delivered: 0 });
      const deliveries = await request(`/api/delivery-partner/deliveries?partnerId=${b.id}`, partnerToken);
      assert.equal(deliveries.status, 200);
      assert.deepEqual((await payload(deliveries)).deliveries, []);
      assert.equal(me.headers.get("cache-control"), "no-store");
    });
    await t.test("customer, vendor and admin cannot use partner operational endpoints", async () => {
      for (const token of tokens.values()) for (const route of ["me", "dashboard", "deliveries"])
        assert.equal((await request(`/api/delivery-partner/${route}`, token)).status, 403);
    });
    await t.test("Phase 7 assignment and duty HTTP routes retain strict role isolation", async () => {
      const id = randomUUID();
      for (const [role, token] of tokens) {
        if (role !== "vendor") {
          assert.equal((await request("/api/vendor/delivery-partners", token)).status,403);
          assert.equal((await request(`/api/vendor/orders/${id}/delivery`,token,"POST",{partnerId:a.id})).status,403);
        }
        assert.equal((await request(`/api/delivery-partner/deliveries/${id}`,token)).status,403);
        assert.equal((await request(`/api/delivery-partner/deliveries/${id}/actions`,token,"POST",{action:"DELIVER"})).status,403);
      }
      assert.equal((await request(`/api/vendor/orders/${id}/delivery`,partnerToken,"POST",{partnerId:a.id})).status,403);
      assert.equal((await request(`/api/delivery-partner/deliveries/${id}/actions`,partnerToken,"POST",{action:"START"})).status,403);
      for (const action of ["OUT_FOR_DELIVERY","DELIVER"]) {
        assert.equal((await request(`/api/vendor/orders/${id}/actions`,tokens.get("vendor")!,"POST",{action})).status,403);
      }
    });
    await t.test("partner cannot read marketplace orders or provision/manage accounts", async () => {
      for (const route of ["/api/customer/orders", "/api/vendor/orders", "/api/admin/orders", "/api/admin/delivery-partners"])
        assert.equal((await request(route, partnerToken)).status, 403);
      assert.equal((await request(`/api/delivery-partner/${b.id}`, partnerToken)).status, 404);
      for (const token of [partnerToken, tokens.get("customer")!, tokens.get("vendor")!])
        assert.equal((await request("/api/admin/delivery-partners", token, "POST", partnerInput)).status, 403);
    });
    await t.test("case-insensitive duplicate provisioning is rejected without another identity", async () => {
      const duplicate = await request("/api/admin/delivery-partners", adminToken, "POST", { ...partnerInput, username: partnerInput.username.toUpperCase() });
      assert.equal(duplicate.status, 409);
      assert.equal((await payload(duplicate)).code, "USERNAME_TAKEN");
    });
    await t.test("incorrect password and unknown username have the same generic login error", async () => {
      for (const credentials of [{ username: partnerInput.username, password: "incorrect" }, { username: username(), password: partnerInput.password }]) {
        const response = await request("/api/delivery-partner/login", "", "POST", credentials);
        assert.equal(response.status, 401);
        assert.equal((await payload(response)).error, "Invalid username or password.");
      }
    });
    await t.test("deactivation denies existing session immediately and new password login clearly", async () => {
      assert.equal((await request(`/api/admin/delivery-partners/${a.id}/status`, adminToken, "PATCH", { status: "INACTIVE" })).status, 200);
      for (const route of ["me", "dashboard", "deliveries"])
        assert.equal((await request(`/api/delivery-partner/${route}`, partnerToken)).status, 403);
      assert.equal((await request("/api/auth/me", partnerToken)).status, 403);
      const inactive = await request("/api/delivery-partner/login", "", "POST", { username: partnerInput.username, password: partnerInput.password });
      assert.equal(inactive.status, 403);
      assert.equal((await payload(inactive)).code, "PARTNER_INACTIVE");
    });
    await t.test("reactivation uses the original identity and session architecture; logout clears session", async () => {
      assert.equal((await request(`/api/admin/delivery-partners/${a.id}/status`, adminToken, "PATCH", { status: "ACTIVE" })).status, 200);
      const auth = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, options);
      assert.equal((await auth.auth.setSession(session)).error, null);
      assert.equal((await request("/api/delivery-partner/me", partnerToken)).status, 200);
      assert.equal((await auth.auth.signOut()).error, null);
      assert.equal((await auth.auth.getSession()).data.session, null);
      assert.equal((await request("/api/delivery-partner/me")).status, 401);
    });
  } finally {
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const deletion = await adminAuth.auth.admin.deleteUser(id);
        if (deletion.error) { failures.push("Auth cleanup failed"); continue; }
        await db.transaction(async tx => {
          await tx.execute(sql`DELETE FROM delivery_partner_profiles WHERE user_id=${id}`);
          await tx.execute(sql`DELETE FROM identity_usernames WHERE user_id=${id}`);
          await tx.execute(sql`DELETE FROM customers WHERE id=${id}`);
          await tx.execute(sql`DELETE FROM user_profiles WHERE id=${id}`);
        });
      } catch { failures.push("Application cleanup failed"); }
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    await getPool().end();
    assert.equal(failures.length, 0, "Temporary identity cleanup must finish");
  }
});