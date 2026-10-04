import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (name: string) => readFile(new URL(`./${name}`, import.meta.url), "utf8");
test("partner login validates literal username input and uses Supabase session tokens without a second password system", async () => {
  const login = await source("DeliveryPartnerLogin.tsx"), app = await source("App.tsx");
  assert.match(login, /usernameSchema\.safeParse\(username\)/);
  assert.match(login, /from "@workspace\/validation"/);
  assert.doesNotMatch(login, /username\.trim\(\)|localStorage|sessionStorage|signUp|password_hash/);
  assert.match(login, /\/api\/delivery-partner\/login/);
  assert.match(app, /supabase\.auth\.setSession\(tokens\)/);
  assert.match(app, /response\.auth\.role === "delivery_partner"/);
  assert.match(app, /<DeliveryPartnerPortal key=\{profile\.userId\}/);
  assert.match(app, /supabase\.auth\.signInWithPassword\(\{\s*email: email\.trim\(\),\s*password,/);
});
test("portal uses partner-only scoped APIs, delivers status actions, and clears cached data on authorization loss", async () => {
  const portal = await source("DeliveryPartnerPortal.tsx");
  for (const path of ["me", "dashboard", "deliveries"]) assert.match(portal, new RegExp(`/api/delivery-partner/${path}`));
  assert.match(portal, /\/api\/delivery-partner\/deliveries\/\$\{encodeURIComponent\(current\.id\)\}\/actions/);
  assert.match(portal, /method: "POST", body: JSON\.stringify\(\{ action \}\)/);
  assert.match(portal, /PENDING: \[\{ action: "ACCEPT"/);
  assert.match(portal, /ACCEPTED: \[\{ action: "PICKUP"/);
  assert.match(portal, /PICKED_UP: \[\{ action: "START"/);
  assert.match(portal, /OUT_FOR_DELIVERY: \[\{ action: "DELIVER"/);
  assert.match(portal, /role="alertdialog"/);
  assert.doesNotMatch(portal, /\/api\/vendor|\/api\/customer|\/api\/admin|<input|<textarea|delivery\.id\.slice/);
  assert.match(portal, /setData\(EMPTY\)/);
  assert.match(portal, /controller\.abort\(\)/);
  assert.match(portal, /No deliveries assigned yet/);
  assert.match(portal, /requestError\.status === 403 \? requestError\.message/);
  assert.match(portal, /window\.setInterval\(\(\) => \{ void reload\(controller\.signal\); \}, POLL_MS\)/);
  assert.match(portal, /snapshotAddress/);
  assert.doesNotMatch(portal, /deliveryContactPhone|customerAccountId|userId|delivery\.id\.slice/);
});
test("admin provisioning submits only approved fields, leaves username immutable and never preserves a password after save", async () => {
  const admin = await source("AdminDeliveryPartners.tsx");
  assert.doesNotMatch(admin, /username\.trim\(\)|localStorage|sessionStorage|method: "DELETE"/);
  assert.match(admin, /setPassword\(""\)/);
  assert.match(admin, /partnerProvisionSchema\.safeParse/);
  assert.match(admin, /\/api\/admin\/delivery-partners/);
  assert.match(admin, /const input: PartnerStatusInput = \{ status: nextStatus \}/);
  assert.match(admin, /DELIVERY_PARTNER/);
});