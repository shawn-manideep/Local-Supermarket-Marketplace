import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { discoveryQuery, matchingCustomerStores } from "./shopping";

test("one shared global query finds visible store names without matching internal codes", () => {
  const eligible = [{ name: "Local Fresh", id: "internal-id", sku: "SECRET" }, { name: "Neighbour Market", id: "other-id", sku: "OTHER" }];
  assert.deepEqual(matchingCustomerStores(eligible, " FRESH "), [eligible[0]]);
  assert.deepEqual(matchingCustomerStores(eligible, "market"), [eligible[1]]);
  assert.deepEqual(matchingCustomerStores(eligible, "SECRET"), []);
  assert.deepEqual(matchingCustomerStores(eligible, "internal-id"), []);
  assert.deepEqual(matchingCustomerStores(eligible, ""), []);
  const productQuery = new URLSearchParams(discoveryQuery("560001", "rice"));
  assert.equal(productQuery.get("search"), "rice");
  assert.equal(productQuery.has("categoryId"), false);
});

test("Customer has one search entry component, no duplicate store search state, and preserves categories/products", async () => {
  const screen = await readFile(new URL("../MarketplaceScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /accessibilityLabel=\{t\("Search products or stores"\)\}/);
  assert.doesNotMatch(screen, /storeSearchQuery|Search supermarkets\.\.\./);
  assert.match(screen, /matchingCustomerStores\(stores, searchQuery\)/);
  assert.match(screen, /\/api\/customer\/products/);
  assert.match(screen, /categoryFilters\(\)/);
  assert.match(screen, /homeCategories\.map/);
  assert.match(screen, /storeDirectoryPincode !== pincode/);
  assert.match(screen, /clearSearch\(\); selectStore\(item\)/);
});

test("Customer login is username-only; registration alone collects a recovery contact and uses existing Supabase identity", async () => {
  const app = await readFile(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(app, /loginCustomerUsername\(\{ username: parsed\.data, password \}\)/);
  assert.match(app, /supabase\.auth\.setSession\(result\.session\)/);
  assert.match(app, /mode === "signup" && <Field\s+label=\{t\("Recovery email address"\)\}/);
  assert.match(app, /customer_signup: true, username: parsed\.data/);
  assert.match(app, /setPassword\(""\)/);
  assert.doesNotMatch(app, /supabase\.auth\.signInWithPassword/);
  assert.match(app, /result\.auth\.role === "customer"/);
  assert.match(app, /customerAccess === "allowed" && verifiedCustomer\.current === session\.user\.id \? <SavedItemsProvider key=\{session\.user\.id\}><CustomerApp \/><\/SavedItemsProvider>/);
  assert.match(app, /\/api\/auth\/me/);
});

test("Customer recovery never asks for email or renders returned account data; reset flow clears secrets", async () => {
  const controls = await readFile(new URL("../components/AuthControls.tsx", import.meta.url), "utf8");
  const recovery = controls.slice(controls.indexOf("export function CustomerRecoveryForm"), controls.indexOf("export function CustomerResetForm"));
  const reset = controls.slice(controls.indexOf("export function CustomerResetForm"));
  assert.match(recovery, /role: "customer", identity: parsed\.data, identityType/);
  assert.match(recovery, /Platform\.OS !== "web" \? \{ client: "customer_native" as const \} : \{\}/);
  assert.match(recovery, /setMessage\(RECOVERY_CONFIRMATION\)/);
  assert.match(recovery, /PasswordField label=\{t\("Re-enter Password"\)\}/);
  assert.doesNotMatch(recovery, /keyboardType="email-address"|data\.user|\.email|reset_token|console\./);
  assert.match(controls, /secureTextEntry=\{visibility\.secureTextEntry\}/);
  assert.match(controls, /setVisible\(value => !value\)/);
  assert.match(reset, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(reset, /setPassword\(""\); setConfirmation\(""\)/);
});
