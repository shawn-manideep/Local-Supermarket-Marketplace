import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const source = async (name: string) => (await readFile(new URL(name, import.meta.url))).toString("utf8");

test("application logo is shared across dashboard auth, vendor, partner and admin identities", async () => {
  const [app, vendor, partnerLogin, partnerPortal, admin] = await Promise.all([
    source("./App.tsx"),
    source("./VendorStorePanel.tsx"),
    source("./DeliveryPartnerLogin.tsx"),
    source("./DeliveryPartnerPortal.tsx"),
    source("./admin/AdminPortal.tsx"),
  ]);
  for (const file of [app, vendor, partnerLogin, partnerPortal, admin]) assert.match(file, /BrandingLogo/);
  const [customer, reset, home, customerLogo] = await Promise.all([
    source("../../customer/App.tsx"), source("../../customer/src/components/AuthControls.tsx"),
    source("../../customer/src/MarketplaceScreen.tsx"), source("../../customer/src/components/CustomerBrandingLogo.tsx"),
  ]);
  for (const file of [customer, reset, home]) assert.match(file, /CustomerBrandingLogo/);
  assert.match(customerLogo, /\/api\/branding/);
  assert.match(customerLogo, /resizeMode="contain"/);
  assert.match(customerLogo, /60_000/);
  assert.match(vendor, /vendor-brand-logo/);
  assert.match(vendor, /store\.name\.slice\(0,1\)/);
  assert.match(vendor, /vendor-application-brand/);
  assert.match(admin, /sectionPath\(target\)/);
  assert.match(admin, /section === "branding" && <AdminBranding token=\{token\}/);
});

test("branding upload enforces raster extensions, MIME agreement, 2 MiB limit and authenticated raw upload", async () => {
  const branding = await source("./branding.ts");
  const editor = await source("./admin/AdminBranding.tsx");
  assert.match(branding, /image\/png/);
  assert.match(branding, /image\/jpeg/);
  assert.match(branding, /2 \* 1024 \* 1024/);
  assert.match(branding, /Authorization: `Bearer \$\{token\}`/);
  assert.match(branding, /credentials: "include"/);
  assert.match(branding, /body: file/);
  assert.match(editor, /URL\.createObjectURL/);
  assert.match(editor, /URL\.revokeObjectURL/);
  assert.match(editor, /dispatchBrandingRefresh/);
});
