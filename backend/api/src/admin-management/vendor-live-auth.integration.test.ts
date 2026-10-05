import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "@workspace/db";
import { vendorProvisionSchema } from "@workspace/validation/vendor-profile";
import { createApp } from "../app.js";
import { provisionVendor } from "./vendor-profile.js";
import { supabasePartnerAuth } from "../delivery-partner/auth-service.js";

// Explicit opt-in, fixed confirmed DEVELOPMENT project, only newly generated
// test identities. Never prints credentials/sessions or edits existing stores.
const enabled = process.env.RUN_VENDOR_PROFILE_LIVE_AUTH === "1";
const password = randomBytes(24).toString("base64url") + "A9!";
const username = `qa_vloc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
let userId: string | undefined, storeId: string | undefined, server: Server, base: string;
let accessToken: string, authEmail: string;
before(async () => {
  if (!enabled) return;
  assert.ok(process.env.SUPABASE_URL === "https://gkwcolipeavxnuzqlamb.supabase.co", "Live test may run only against the confirmed development project");
  const [actor] = (await getPool().query("SELECT id FROM user_profiles WHERE role='admin' ORDER BY created_at LIMIT 1")).rows;
  assert.ok(actor, "Existing development Admin is required");
  const account = await provisionVendor(vendorProvisionSchema.parse({
    username, password, name: "Temporary Store Location QA", ownerName: "Temporary QA Owner",
    addressLine1: "QA Address", locality: "QA Locality", city: "Hyderabad", state: "Telangana", pincode: "500090",
  }), actor.id);
  assert.ok("store" in account && account.store, "Provisioned vendor must have a store");
  userId = account.store.ownerUserId; storeId = account.store.id;
  const [identity] = (await getPool().query("SELECT email FROM auth.users WHERE id=$1", [userId])).rows;
  authEmail = identity.email;
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
}, { timeout: 90000 });
after(async () => {
  if (!enabled) return;
  try {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (userId) {
      const id = userId;
      await getDb().transaction(async tx => {
        await tx.execute(sql`DELETE FROM platform_management_events WHERE action='vendor_created'
          AND target_type='store' AND target_id=${storeId}`);
        await tx.execute(sql`DELETE FROM stores WHERE owner_user_id=${id}`);
        await tx.execute(sql`DELETE FROM identity_usernames WHERE user_id=${id}`);
        await tx.execute(sql`DELETE FROM customers WHERE id=${id}`);
        await tx.execute(sql`DELETE FROM user_profiles WHERE id=${id}`);
      });
      await supabasePartnerAuth().remove(id);
      assert.ok((await getPool().query("SELECT id FROM auth.users WHERE id=$1", [id])).rows.length === 0, "Temporary identity cleanup must succeed");
    }
  } finally { await getPool().end(); }
});
test("real Supabase vendor provisioning and username login issue the existing password session", { skip: !enabled }, async () => {
  const response = await fetch(`${base}/api/vendor/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: username.toUpperCase(), password }),
  });
  assert.ok(response.status === 200, "Real vendor username login must succeed");
  const payload = await response.json() as { session: { access_token: string; refresh_token: string } };
  assert.ok(typeof payload.session.access_token === "string" && payload.session.access_token.length > 50, "Real session token is required");
  assert.ok(!JSON.stringify(payload).includes(password), "Password must not be returned");
  accessToken = payload.session.access_token;
  const me = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.ok(me.status === 200, "New session must pass existing Auth middleware");
  const identity = await me.json() as { auth: { role: string; userId: string; storeId: string } };
  assert.ok(identity.auth.role === "vendor" && identity.auth.userId === userId && identity.auth.storeId === storeId);
  const profile = await fetch(`${base}/api/vendor/store`, { headers: { Authorization: `Bearer ${accessToken}` } });
  assert.ok(profile.status === 200);
  const result = await profile.json() as { store: { status: string; locality: string } };
  assert.ok(result.store.status === "PENDING_APPROVAL" && result.store.locality === "QA Locality");
  assert.ok((await getPool().query("SELECT id FROM products WHERE store_id=$1", [storeId])).rows.length === 0);
});
test("same new vendor identity remains compatible with existing Supabase email/password sign-in", { skip: !enabled }, async () => {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_ANON_KEY! },
    body: JSON.stringify({ email: authEmail, password }),
  });
  assert.ok(response.status === 200, "Original Supabase email-password mechanism must remain available");
  const session = await response.json() as { user: { id: string }; access_token: string };
  assert.ok(session.user.id === userId && typeof session.access_token === "string");
});
