import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readSeenOfferIds, rememberSeenOfferIds, unseenOffers } from "./delivery-offer-notifications";
import { readBrowserNotificationIds, rememberBrowserNotificationIds } from "./BrowserNotificationControl";

const source = (name: string) => readFile(new URL(`./${name}`, import.meta.url), "utf8");
test("partner login validates literal username input and uses Supabase session tokens without a second password system", async () => {
  const login = await source("DeliveryPartnerLogin.tsx"), app = await source("App.tsx");
  assert.match(login, /usernameSchema\.safeParse\(username\)/);
  assert.match(login, /from "@workspace\/validation"/);
  assert.doesNotMatch(login, /username\.trim\(\)|localStorage|sessionStorage|signUp|password_hash/);
  assert.match(login, /\/api\/delivery-partner\/login/);
  assert.match(app, /supabase\.auth\.setSession\(tokens\)/);
  assert.match(app, /profile\.role === "delivery_partner" && portalRoute === "delivery-dashboard"/);
  assert.match(app, /portalRouteMatchesRole\(profile\.role, portalRoute\)/);
  assert.match(app, /<DeliveryPartnerPortal key=\{profile\.userId\}/);
  assert.match(app, /supabase\.auth\.signInWithPassword\(\{\s*email: email\.trim\(\),\s*password,/);
});
test("portal uses partner-only scoped APIs, delivers status actions, and clears cached data on authorization loss", async () => {
  const portal = await source("DeliveryPartnerPortal.tsx");
  const component = portal.slice(portal.indexOf("export function DeliveryPartnerPortal"));
  for (const path of ["me", "dashboard", "deliveries"]) assert.match(portal, new RegExp(`/api/delivery-partner/${path}`));
  assert.match(component, /\/api\/delivery-partner\/deliveries\/\$\{encodeURIComponent\(current\.id\)\}\/actions/);
  assert.match(component, /method: "POST", body: JSON\.stringify\(\{ action \}\)/);
  assert.match(portal, /PENDING: \[\{ action: "ACCEPT"/);
  assert.match(portal, /ACCEPTED: \[\{ action: "PICKUP"/);
  assert.match(portal, /PICKED_UP: \[\{ action: "START"/);
  assert.match(portal, /OUT_FOR_DELIVERY: \[\{ action: "DELIVER"/);
  assert.match(component, /role="alertdialog"/);
  assert.doesNotMatch(component, /\/api\/vendor|\/api\/customer|\/api\/admin/);
  assert.match(component, /type="date" value=\{reportDate\}/);
  assert.match(component, /type="file" accept="image\/jpeg,image\/png" capture="environment"/);
  assert.match(portal, /savePdf\(`\/api\/delivery-partner\/reports\/daily\.pdf/);
  assert.match(component, /setData\(EMPTY\)/);
  assert.match(component, /controller\.abort\(\)/);
  assert.match(component, /No deliveries assigned yet/);
  assert.match(component, /requestError\.status === 403 \? requestError\.message/);
  assert.match(component, /window\.setInterval\(\(\) => \{ void reload\(controller\.signal\); \}, POLL_MS\)/);
  assert.match(component, /snapshotAddress/);
  assert.doesNotMatch(component, /deliveryContactPhone|customerAccountId|userId|delivery\.id\.slice/);
});
test("new delivery offers use a global accept dialog and remain deduplicated after reconnects or reloads", async () => {
  const portal = await source("DeliveryPartnerPortal.tsx");
  assert.match(portal, /role="alertdialog" aria-modal="true"/);
  assert.match(portal, /New delivery offer/);
  assert.match(portal, /Accept delivery/);
  assert.match(portal, /readSeenOfferIds\(username/);
  assert.match(portal, /runRefreshEventStream\("\/api\/delivery-partner\/events"/);
  assert.match(portal, /checkOffers\(true\)/);
  assert.match(portal, /window\.setInterval\(\(\) => void checkOffers\(\), OFFER_POLL_MS\)/);
  assert.match(portal, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(portal, /\/api\/delivery-partner\/orders\/\$\{encodeURIComponent\(offer\.orderId\)\}\/claim/);
  assert.doesNotMatch(portal, /partnerId:\s*offer/);

  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const sessionOne = readSeenOfferIds("Partner_One", storage);
  const remembered = rememberSeenOfferIds("Partner_One", ["order-1"], sessionOne, storage);
  assert.deepEqual(unseenOffers([{ orderId: "order-1" }, { orderId: "order-2" }], remembered).map((offer) => offer.orderId), ["order-2"]);
  const reloaded = readSeenOfferIds("partner_one", storage);
  assert.deepEqual(unseenOffers([{ orderId: "order-1" }, { orderId: "order-2" }], reloaded).map((offer) => offer.orderId), ["order-2"]);
  assert.deepEqual([...readSeenOfferIds("partner_two", storage)], []);

  const browserNotified = rememberBrowserNotificationIds("partner:partner_one", ["order-1"], new Set(), storage);
  assert.deepEqual([...readBrowserNotificationIds("partner:partner_one", storage)], [...browserNotified]);
  assert.deepEqual([...readBrowserNotificationIds("partner:partner_two", storage)], []);
  const browserControl = await source("BrowserNotificationControl.tsx");
  assert.match(browserControl, /Notification\.requestPermission\(\)/);
  assert.match(browserControl, /document\.visibilityState !== "hidden"/);
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