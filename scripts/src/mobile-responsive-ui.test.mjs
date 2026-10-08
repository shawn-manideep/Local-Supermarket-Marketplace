import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = path => readFile(resolve(root, path), "utf8");
async function files(directory, extension) {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(path, extension));
    else if (entry.name.endsWith(extension) && !entry.name.includes(".test.")) result.push(path);
  }
  return result;
}
const cssPaths = await files("apps/dashboard/src", ".css");
const styles = await Promise.all(cssPaths.map(source));
const css = styles.join("\n");

test("portal styles have balanced blocks outside comments and strings", () => {
  styles.forEach((text, index) => {
    const clean = text.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
    let depth = 0;
    for (const char of clean) {
      if (char === "{") depth++;
      if (char === "}") depth--;
      assert.ok(depth >= 0, cssPaths[index]);
    }
    assert.equal(depth, 0, cssPaths[index]);
  });
});
test("Vendor mobile navigation is labeled, keyboard-dismissible and releases on desktop resize", async () => {
  const text = await source("apps/dashboard/src/VendorStorePanel.tsx");
  for (const token of ['aria-expanded={mobileMenuOpen}', 'aria-controls="vendor-primary-navigation"',
    '"Escape"', "mobileMenuButton", 'removeEventListener("change"', "closeOnDesktop"]) assert.ok(text.includes(token), token);
  assert.match(css, /\.vendor-sidebar\.is-mobile-open/);
  assert.match(css, /width:\s*min\(300px,\s*calc\(100vw\s*-\s*40px\)\)/);
});
test("Admin mobile navigation has disclosure and matching controls, focus restoration and resize cleanup", async () => {
  const text = await source("apps/dashboard/src/admin/AdminPortal.tsx");
  for (const token of ['aria-expanded={mobileMenuOpen}', 'aria-controls="admin-primary-navigation"',
    'id="admin-primary-navigation"', '"Escape"', 'removeEventListener("change"', "closeOnDesktop"]) assert.ok(text.includes(token), token);
  assert.match(css, /\.lb-admin-sidebar\.is-mobile-open/);
});
test("all five current native tables have an explicit mobile treatment", async () => {
  const tableFiles = [];
  let count = 0;
  for (const path of await files("apps/dashboard/src", ".tsx")) {
    const text = await source(path);
    if (text.includes("<table")) { tableFiles.push(path); count += (text.match(/<table\b/g) ?? []).length; }
  }
  assert.equal(count, 5);
  assert.deepEqual(tableFiles.sort(), [
    "apps/dashboard/src/AdminCatalogExcelPanel.tsx",
    "apps/dashboard/src/AdminDeliveryPartners.tsx",
    "apps/dashboard/src/OrderOperations.tsx",
    "apps/dashboard/src/admin/AdminPortal.tsx",
  ].sort());
});
test("mobile account and partner directory cells retain meaningful labels", async () => {
  for (const path of ["apps/dashboard/src/AdminDeliveryPartners.tsx", "apps/dashboard/src/admin/AdminPortal.tsx"]) {
    const text = await source(path);
    const cells = text.match(/<td\b[^>]*>/g) ?? [];
    assert.ok(cells.length > 0);
    for (const cell of cells) assert.match(cell, /data-label=/, `${path}: ${cell}`);
  }
  assert.match(css, /content:\s*attr\(data-label\)/);
});
test("wide Excel comparisons/history are separately named keyboard-focusable scroll regions", async () => {
  const text = await source("apps/dashboard/src/AdminCatalogExcelPanel.tsx");
  for (const className of ["lb-catalog-changes", "lb-catalog-history-table-wrap"]) {
    const tag = text.match(new RegExp(`<div className="${className}"[^>]*>`))?.[0];
    assert.ok(tag, className); assert.match(tag, /role="region"/); assert.match(tag, /aria-label=/); assert.match(tag, /tabIndex=\{0\}/);
  }
  assert.match(css, /overflow-x:\s*auto/);
});
test("shared mobile rules provide shrinking tracks, safe areas, readable inputs and touch targets", () => {
  for (const pattern of [/minmax\(0,\s*1fr\)/, /min-width:\s*0/, /safe-area-inset-bottom/,
    /min-height:\s*44px/, /font-size:\s*16px/, /100dvh/, /overflow-y:\s*auto/]) assert.match(css, pattern);
});
test("Vendor mobile fields stack and Delivery Partner card layouts keep mobile overrides", async () => {
  const vendor = await source("apps/dashboard/src/index.css");
  assert.match(vendor, /@media\s*\(max-width:\s*600px\)/);
  assert.match(vendor, /\.vendor-new-variant-fields,\s*\.vendor-selling-variant-fields\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  const partner = await source("apps/dashboard/src/partner.css");
  assert.match(partner, /@media\s*\(max-width:\s*420px\)/);
  assert.match(partner, /\.lbp-table tbody tr\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
test("Customer retains bounded desktop scrolling, existing navigation and keyboard-tappable forms", async () => {
  const bounds = await source("apps/customer/src/lib/viewport-layout.ts");
  assert.match(bounds, /minHeight:\s*0/); assert.match(bounds, /minWidth:\s*0/);
  assert.match(bounds, /height:\s*viewportHeight,\s*maxHeight:\s*viewportHeight/);
  const app = await source("apps/customer/App.tsx");
  assert.match(app, /customerWebShellBounds/);
  assert.match(app, /keyboardShouldPersistTaps="handled"/);
  assert.match(app, /SavedItemsScreen/); assert.match(app, /CustomerSettingsScreen/);
});
test("Customer narrow-grid fallback and wrapping preserve usable cards rather than hiding overflow", async () => {
  const marketplace = await source("apps/customer/src/MarketplaceScreen.tsx");
  assert.match(marketplace, /useWindowDimensions/);
  assert.match(marketplace, /360/);
  const card = await source("apps/customer/src/components/ShoppingProductCard.tsx");
  assert.match(card, /singleColumn:\s*\{\s*width:\s*"100%"/);
  assert.match(card, /minWidth:\s*0/);
  const saved = await source("apps/customer/src/SavedItemsScreen.tsx");
  assert.match(saved, /flexWrap:\s*"wrap"/);
});
test("Customer password input shrinks so its visibility button remains inside the phone viewport", async () => {
  const text = await source("apps/customer/src/components/AuthControls.tsx");
  assert.match(text, /passwordInput:\s*\{[^}]*minWidth:\s*0/);
  assert.match(text, /passwordRow:\s*\{[^}]*minWidth:\s*0/);
  assert.match(text, /eyeButton:\s*\{[^}]*width:\s*48,[^}]*flexShrink:\s*0/);
});
