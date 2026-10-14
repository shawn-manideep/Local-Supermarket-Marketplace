import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("all three portals default to mobile/password and preserve explicit legacy sign-in without changing Admin", async () => {
  const [dashboard, partner, customer] = await Promise.all([
    read("./App.tsx"), read("./DeliveryPartnerLogin.tsx"), read("../../customer/App.tsx"),
  ]);
  for (const source of [dashboard, partner, customer]) {
    assert.match(source, /Mobile Number/);
    assert.match(source, /Enter your registered mobile number/);
    assert.match(source, /indianMobileSchema\.safeParse/);
    assert.match(source, /setPassword\(""\)/);
    assert.doesNotMatch(source, /Email or vendor username/);
  }
  assert.match(dashboard, /legacyVendorLogin, setLegacyVendorLogin\] = useState\(false\)/);
  assert.match(partner, /legacyLogin, setLegacyLogin\] = useState\(false\)/);
  assert.match(customer, /legacyLogin, setLegacyLogin\] = useState\(false\)/);
  assert.match(dashboard, /\/api\/vendor\/mobile-login/);
  assert.match(dashboard, /\/api\/vendor\/login/);
  assert.match(partner, /\/api\/delivery-partner\/mobile-login/);
  assert.match(partner, /\/api\/delivery-partner\/login/);
  assert.match(customer, /loginCustomerMobile\(\{ mobileNumber: parsed\.data, password \}\)/);
  assert.match(customer, /loginCustomerUsername\(\{ username: parsed\.data, password \}\)/);
  assert.match(dashboard, /if \(!adminMode && !legacyVendorLogin\)/);
  assert.match(dashboard, /supabase\.auth\.signInWithPassword\(\{\s*email: email\.trim\(\),\s*password/);
  assert.match(dashboard, /adminMode \? <label>Email address/);
  assert.match(dashboard, /Admin access is verified before the portal opens/);
});

test("non-Admin recovery shows two passwords and keeps Save disabled until verified recovery; Admin presentation is preserved", async () => {
  const [dashboard, customer] = await Promise.all([
    read("./AuthControls.tsx"), read("../../customer/src/components/AuthControls.tsx"),
  ]);
  for (const source of [dashboard, customer]) {
    assert.match(source, /Re-enter Password/);
    assert.match(source, /Save Password/);
    assert.match(source, /Verify account ownership/);
    assert.match(source, /portalResetPasswordSchema/);
    assert.match(source, /password !== confirmation/);
    assert.match(source, /isPasswordOwner\(/);
    assert.match(source, /current\.session\?\.access_token !== before\.session\.access_token/);
    assert.match(source, /supabase\.auth\.updateUser\(\{ password \}\)/);
    assert.match(source, /signOut\(\)/);
    const beforeVerified = source.slice(0, source.indexOf(source.includes("export function ResetPassword") ? "export function ResetPassword" : "export function CustomerResetForm"));
    assert.doesNotMatch(beforeVerified, /updateUser\(/);
    assert.doesNotMatch(beforeVerified, /JSON\.stringify\([^)]*password/);
  }
  assert.match(dashboard, /role !== "admin" && <button[^>]*disabled[^>]*>Save Password/);
  assert.match(dashboard, /role === "admin" \? "Send Reset Instructions"/);
  assert.match(dashboard, /role === "admin" \? "Update password"/);
  assert.match(dashboard, /role !== "admin" \? \{ identityType \} : \{\}/);
  assert.match(customer, /accessibilityState=\{\{ disabled: true \}\} disabled/);
});

test("registration retains safe email recovery and Partner provisioning remains Admin-only", async () => {
  const [vendor, customer, partner, provisioning] = await Promise.all([
    read("./VendorSignup.tsx"), read("../../customer/App.tsx"), read("./DeliveryPartnerLogin.tsx"),
    read("../../../backend/api/src/delivery-partner/routes.ts"),
  ]);
  assert.match(vendor, /Registration still requires a recovery email/);
  assert.match(vendor, /email: email\.trim\(\), password/);
  assert.match(customer, /Registration still uses a recovery email/);
  assert.match(customer, /customer_signup: true/);
  assert.doesNotMatch(partner, /signUp\(|createUser\(/);
  assert.match(provisioning, /post\("\/api\/admin\/delivery-partners", requireRole\("admin"\)/);
});
