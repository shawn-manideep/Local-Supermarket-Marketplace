import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { indianMobileSchema, mobileRegistrationSchema, portalResetPasswordSchema, resetPasswordSchema } from "@workspace/validation";
import { vendorRegistrationSchema } from "@workspace/validation/vendor-profile";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const valid = { mobileNumber: "9876543210", password: "Password1", confirmation: "Password1" };

test("registration shares login phone normalization and never treats normalization as ownership", () => {
  for (const mobileNumber of ["9876543210", "+919876543210", " +919876543210 "]) {
    const parsed = mobileRegistrationSchema.parse({ ...valid, mobileNumber });
    assert.equal(parsed.mobileNumber, indianMobileSchema.parse(mobileNumber));
    assert.equal(parsed.mobileNumber, "+919876543210");
    assert.equal(Object.hasOwn(parsed, "verified"), false);
    assert.equal(Object.hasOwn(parsed, "role"), false);
  }
});

test("registration rejects malformed numbers, other countries and incorrectly formatted Indian prefixes", () => {
  for (const mobileNumber of ["", "123", "5876543210", "919876543210", "+19876543210", "98765 43210", "98765432101"])
    assert.equal(mobileRegistrationSchema.safeParse({ ...valid, mobileNumber }).success, false);
});

test("both registration forms reject weak or mismatched passwords and excessive values", () => {
  for (const password of ["short1", "abcdefgh", "12345678", `${"a".repeat(128)}1`]) {
    assert.equal(mobileRegistrationSchema.safeParse({ ...valid, password, confirmation: password }).success, false);
    assert.equal(portalResetPasswordSchema.safeParse(password).success, false);
  }
  for (const confirmation of ["", "Password2", `${"a".repeat(129)}`])
    assert.equal(mobileRegistrationSchema.safeParse({ ...valid, confirmation }).success, false);
  assert.equal(resetPasswordSchema.safeParse("abcdefgh").success, true, "Admin password validation remains unchanged");
});

test("registration input never accepts caller-assigned identities, phone confirmation or approval bypass", () => {
  for (const field of ["role", "id", "userId", "email", "phone_confirmed_at", "phone_confirm", "verified", "status", "documentsRequired", "storeId"])
    assert.equal(mobileRegistrationSchema.safeParse({ ...valid, [field]: true }).success, false, field);
});

test("Vendor shop validation reuses the existing authoritative profile rules", () => {
  assert.equal(vendorRegistrationSchema.shape.name.safeParse("").success, false);
  assert.equal(vendorRegistrationSchema.shape.name.safeParse("   ").success, false);
  assert.equal(vendorRegistrationSchema.shape.name.parse(" Corner Shop "), "Corner Shop");
});

test("email-free default forms have the required fields, validate without network calls and cannot create duplicate/unverified accounts", async () => {
  const [customer, vendor] = await Promise.all([
    read("../../customer/src/components/MobileRegistrationForm.tsx"), read("./MobileVendorSignup.tsx"),
  ]);
  for (const source of [customer, vendor]) {
    for (const label of ["Mobile Number", "Password", "Confirm Password"]) assert.ok(source.includes(label));
    assert.match(source, /mobileRegistrationSchema\.safeParse\(\{ mobileNumber, password, confirmation \}\)/);
    assert.match(source, /Email-free registration is not yet available/);
    assert.match(source, /no account was created/);
    assert.match(source, /Check details/);
    assert.match(source, /setPassword\(""\); setConfirmation\(""\)/);
    assert.doesNotMatch(source, /type="email"|autoComplete="email"|keyboardType="email-address"/);
    assert.doesNotMatch(source, /supabase|apiRequest|fetch\(|signUp\(|createUser\(|updateUser\(|localStorage|AsyncStorage/);
  }
  assert.match(vendor, /Shop Name/);
  assert.match(vendor, /vendorRegistrationSchema\.shape\.name\.safeParse\(shopName\)/);
  assert.match(vendor, /Admin approval and mandatory document verification/);
  assert.match(vendor, /onSubmit=\{validate\}/);
});

test("default routing hides email inputs, while explicit legacy registration remains functional and guarded", async () => {
  const [customer, vendor] = await Promise.all([read("../../customer/App.tsx"), read("./VendorSignup.tsx")]);
  assert.match(customer, /legacyRegistration, setLegacyRegistration\] = useState\(false\)/);
  assert.match(customer, /mode === "signup" && !legacyRegistration \? <>[\s\S]*?<MobileRegistrationForm/);
  assert.match(vendor, /legacyRegistration, setLegacyRegistration\] = useState\(false\)/);
  assert.match(vendor, /if \(!session && !legacyRegistration\) return <MobileVendorSignup/);
  for (const source of [customer, vendor]) {
    assert.match(source, /if \(!legacyRegistration\) return/);
    assert.match(source, /portalResetPasswordSchema\.safeParse\(password\)/);
    assert.match(source, /password !== confirmation/);
    assert.match(source, /supabase\.auth\.signUp\(\{/);
    assert.match(source, /email: email\.trim\(\), password/);
  }
  assert.match(customer, /customer_signup: true, username: parsed\.data/);
  assert.match(vendor, /vendor_signup: true, username: name\.data/);
  assert.match(vendor, /onSubmit=\{session \? finish : begin\}/);
  assert.match(vendor, /apiRequest\("\/api\/vendor\/register", session\.access_token/);
});

test("email-free creation remains blocked by the inspected architecture, and legacy/Admin/Partner authentication gates remain intact", async () => {
  const [gateway, vendor, customer, dashboard, partnerRoutes, vendorGate] = await Promise.all([
    read("../../../backend/api/src/delivery-partner/auth-service.ts"),
    read("../../../backend/api/src/auth/vendor-registration.ts"), read("../../customer/App.tsx"),
    read("./App.tsx"), read("../../../backend/api/src/delivery-partner/routes.ts"),
    read("../../../backend/api/src/auth/vendor-registration-guards.ts"),
  ]);
  assert.match(gateway, /signInWithPassword\(\{ email, password \}\)/);
  assert.match(vendor, /isVerifiedVendorSignup\(data\.user, request\.auth\.userId\)/);
  assert.match(vendor, /'PENDING_APPROVAL',true/);
  assert.match(vendorGate, /email_confirmed_at/);
  assert.match(customer, /loginCustomerUsername\(/);
  assert.match(dashboard, /supabase\.auth\.signInWithPassword\(\{\s*email: email\.trim\(\),\s*password/);
  assert.match(dashboard, /\/api\/vendor\/login/);
  assert.match(partnerRoutes, /post\("\/api\/admin\/delivery-partners", requireRole\("admin"\)/);
});
