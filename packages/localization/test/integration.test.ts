import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("Customer keeps a stable provider and dedicated account-scoped AsyncStorage", () => {
  const customer = read("apps/customer/index.ts");
  assert.match(customer, /LanguageProvider/);
  assert.match(customer, /local-basket:customer:language:v1/);
  assert.doesNotMatch(customer, /key=.*(?:language|scope)/);
  assert.match(read("apps/customer/App.tsx"), /useLanguageScope\(session\?\.user\.id \?\? null\)/);
  const adapter = read("apps/customer/src/lib/language-storage.ts");
  assert.match(adapter, /AsyncStorage\.getItem/);
  assert.match(adapter, /AsyncStorage\.setItem/);
  assert.doesNotMatch(adapter, /supabase|signOut|removeItem|clear\(/);
});

test("Customer auth, recovery/reset and Settings retain accessible language controls", () => {
  for (const path of [
    "apps/customer/App.tsx",
    "apps/customer/src/components/AuthControls.tsx",
    "apps/customer/src/CustomerSettingsScreen.tsx",
  ]) assert.match(read(path), /CustomerLanguageSelector/);
  const app = read("apps/customer/App.tsx");
  assert.ok(app.indexOf("<CustomerLanguageSelector") < app.indexOf("<CustomerRecoveryForm"));
  const selector = read("apps/customer/src/components/LanguageSelector.tsx");
  assert.match(selector, /accessibilityRole="radio"/);
  assert.match(selector, /accessibilityState=\{\{ checked: selected \}\}/);
  assert.match(selector, /minHeight: 44/);
  assert.match(selector, /common\.languageHelp/);
});

test("other portals have no localization provider, selector, storage adapter or font changes", () => {
  const paths = readdirSync(new URL("apps/dashboard/src/", root), { recursive: true });
  for (const path of paths) {
    if (!/\.(?:tsx?|css)$/.test(String(path))) continue;
    assert.doesNotMatch(read(`apps/dashboard/src/${path}`), /@workspace\/localization|useLanguageScope|LanguageProvider|LanguageSelector|lb-language-|Noto Sans Telugu/, String(path));
  }
  assert.equal(existsSync(new URL("apps/dashboard/src/language-storage.ts", root)), false);
  assert.equal(existsSync(new URL("apps/dashboard/src/LanguageSelector.tsx", root)), false);
  assert.doesNotMatch(read("apps/dashboard/package.json"), /@workspace\/localization/);
});
