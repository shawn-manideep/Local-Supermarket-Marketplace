import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { passwordVisibility } from "@workspace/constants";
import { resetPasswordSchema } from "@workspace/validation";
const source = async (name: string): Promise<string> => (await readFile(new URL(name, import.meta.url))).toString("utf8");

test("shared password visibility transitions hidden → visible → hidden with accessible eye labels", () => {
  let visible = false;
  for (const expected of ["password", "text", "password"]) {
    const result = passwordVisibility(visible);
    assert.equal(result.inputType, expected);
    assert.equal(result.secureTextEntry, !visible);
    assert.equal(result.label, visible ? "Hide password" : "Show password");
    visible = !visible;
  }
});

test("Vendor, Partner and Admin reuse password/recovery controls without nested forms", async () => {
  const [app, partner, controls] = await Promise.all([source("./App.tsx"), source("./DeliveryPartnerLogin.tsx"), source("./AuthControls.tsx")]);
  assert.match(app, /<PasswordInput data-testid="input-password"/);
  assert.match(app, /role=\{adminMode \? "admin" : "vendor"\}/);
  assert.match(partner, /<PasswordInput id="lbp-password"/);
  assert.match(partner, /<ForgotPassword[^>]*role="delivery_partner"/);
  assert.match(app, /<\/form>[\s\S]*?<ForgotPassword/);
  assert.match(partner, /<\/form>\s*<button[\s\S]*?<ForgotPassword/);
  assert.match(controls, /setVisible\(value => !value\)/);
  assert.match(controls, /type="button" className="auth-eye"/);
  assert.match(controls, /aria-pressed=\{visible\}/);
});

test("recovery preserves role identities and displays only generic confirmation/errors", async () => {
  const controls = await source("./AuthControls.tsx");
  assert.match(controls, /Re-enter New Password/);
  assert.doesNotMatch(controls, /value=\{identity\}/);
  assert.match(controls, /JSON\.stringify\(\{\s*role, identity/);
  assert.match(controls, /setMessage\(RECOVERY_CONFIRMATION\)/);
  assert.doesNotMatch(controls, /data\.user|recoveryEmail|reset_token|error\.message|console\./);
});

test("reset completion uses Supabase updateUser, validates confirmation, clears passwords and signs out", async () => {
  const [controls, app] = await Promise.all([source("./AuthControls.tsx"), source("./App.tsx")]);
  assert.match(controls, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(controls, /password !== confirmation/);
  assert.match(controls, /setPassword\(""\); setConfirmation\(""\)/);
  assert.match(controls, /supabase\.auth\.signOut\(\)/);
  assert.match(app, /event === "PASSWORD_RECOVERY"/);
  assert.match(app, /window\.history\.replaceState/);
  assert.equal(resetPasswordSchema.safeParse("short").success, false);
  assert.equal(resetPasswordSchema.safeParse("ValidPassword12!").success, true);
});

test("Vendor has no dedicated Delivery navigation/page, while READY summary opens existing Orders", async () => {
  const vendor = await source("./VendorStorePanel.tsx");
  assert.doesNotMatch(vendor, /setCurrentTab\("delivery"\)|currentTab === "delivery"|onNavigate\("delivery"\)|vendorView="delivery"/);
  assert.match(vendor, /vendor-metric-card ready" onClick=\{\(\) => onNavigate\("orders"\)\}/);
  assert.match(vendor, /<OrderOperations/);
  const app = await source("./App.tsx");
  assert.match(app, /portalRouteMatchesRole\(profile\.role, portalRoute\)/);
  assert.match(app, /profile\.role === "delivery_partner" && portalRoute === "delivery-dashboard"/);
  assert.doesNotMatch(app, /Delivery Partner sign in/);
});

test("Vendor and Delivery Partner have independent direct entry and dashboard routes", async () => {
  const [app, partner, routes] = await Promise.all([
    source("./App.tsx"), source("./DeliveryPartnerLogin.tsx"), source("./portal-routes.ts"),
  ]);
  assert.match(routes, /"\/vendor\/login"/);
  assert.match(routes, /"\/vendor\/dashboard"/);
  assert.match(routes, /"\/delivery\/login"/);
  assert.match(routes, /"\/delivery\/dashboard"/);
  assert.match(app, /setPortalRoute/);
  assert.match(app, /loginForDashboard\(portalRoute\)/);
  assert.match(app, /!portalRouteMatchesRole\(profile\.role, portalRoute\)/);
  assert.doesNotMatch(app, /selectPortal/);
  assert.doesNotMatch(partner, /onCancel|button-partner-login-cancel/);
});

test("Partner UI uses existing real summary data without mislabelling all-time counters as today's deliveries", async () => {
  const partner = await source("./DeliveryPartnerPortal.tsx");
  assert.match(partner, /data\.summary\?\.\[key\]/);
  assert.match(partner, /data\.deliveries\?/);
  assert.match(partner, /total assigned deliveries/);
  assert.doesNotMatch(partner, /assignments recorded today|Today's activity|sampleDeliveries|mockDeliveries/);
});
