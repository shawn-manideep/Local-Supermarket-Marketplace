import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("both app roots keep stable providers and separate dedicated preference storage", () => {
  const customer = read("apps/customer/index.ts");
  const dashboard = read("apps/dashboard/src/main.tsx");
  assert.match(customer, /LanguageProvider/);
  assert.match(dashboard, /LanguageProvider/);
  assert.match(customer, /local-basket:customer:language:v1/);
  assert.match(dashboard, /local-basket:dashboard:language:v1/);
  for (const source of [customer, dashboard]) assert.doesNotMatch(source, /key=.*(?:language|scope)/);
  for (const app of ["apps/customer/App.tsx", "apps/dashboard/src/App.tsx"]) {
    assert.match(read(app), /useLanguageScope\(session\?\.user\.id \?\? null\)/);
  }
  assert.match(read("apps/customer/src/lib/language-storage.ts"), /AsyncStorage\.getItem/);
  assert.match(read("apps/dashboard/src/language-storage.ts"), /window\.localStorage\.getItem/);
});

test("selectors are available in every Phase 1 auth, recovery, settings and portal location", () => {
  for (const path of [
    "apps/customer/App.tsx",
    "apps/customer/src/components/AuthControls.tsx",
    "apps/customer/src/CustomerSettingsScreen.tsx",
    "apps/dashboard/src/App.tsx",
    "apps/dashboard/src/DeliveryPartnerLogin.tsx",
    "apps/dashboard/src/VendorStorePanel.tsx",
    "apps/dashboard/src/DeliveryPartnerPortal.tsx",
    "apps/dashboard/src/admin/AdminPortal.tsx",
  ]) assert.match(read(path), /LanguageSelector/);
  const native = read("apps/customer/src/components/LanguageSelector.tsx");
  assert.match(native, /accessibilityRole="radio"/);
  assert.match(native, /accessibilityState=\{\{ checked: selected \}\}/);
  assert.match(native, /minHeight: 44/);
  const web = read("apps/dashboard/src/LanguageSelector.tsx");
  assert.match(web, /type="button"/);
  assert.match(web, /aria-pressed=\{selected\}/);
  assert.match(web, /lang=\{code\}/);
  assert.match(native, /common\.languageHelp/);
  assert.match(web, /common\.languageHelp/);
});
