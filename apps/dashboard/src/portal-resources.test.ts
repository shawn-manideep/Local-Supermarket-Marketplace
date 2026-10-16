import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { legalEn } from "../../../packages/localization/src/legal-copy";
import { portalResourceItems, portalResourceSections } from "./portal-resource-content";

const appText = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

test("Vendor and Delivery Partner menus expose the same four functional resource destinations", () => {
  assert.deepEqual(portalResourceItems.map(({ id, title }) => [id, title]), [
    ["help", "Help & Support"],
    ["privacy", "Privacy Policy"],
    ["accountPrivacy", "Account Privacy"],
    ["terms", "Terms & Conditions"],
  ]);
  const menu = appText("PortalResources.tsx");
  const vendor = appText("VendorStorePanel.tsx");
  const partner = appText("DeliveryPartnerPortal.tsx");
  assert.match(menu, /onClick=\{\(\) => onOpen\(item\.id\)\}/);
  assert.match(menu, /portal-resource-chevron/);
  assert.match(vendor, /<PortalResourceMenu role="vendor" onOpen=\{onOpenResource\}/);
  assert.match(vendor, /onBack=\{\(\) => navigateVendor\("settings"\)\}/);
  assert.match(partner, /<PortalResourceMenu role="delivery_partner"/);
  assert.match(partner, /onOpen=\{\(resource\) => setScreen\(resource\)\}/);
  assert.match(partner, /onBack=\{\(\) => setScreen\("profile"\)\}/);
});

test("Help pages give role-specific workflow guidance and disclose the missing support destination", () => {
  const vendorHelp = portalResourceSections("vendor", "help").map((section) => section.body).join(" ");
  const partnerHelp = portalResourceSections("delivery_partner", "help").map((section) => section.body).join(" ");
  for (const topic of ["Catalog", "stock", "order", "Documents", "bank details", "FSSAI"])
    assert.match(vendorHelp, new RegExp(topic, "i"));
  for (const topic of ["offer", "pickup", "photograph", "status", "report"])
    assert.match(partnerHelp, new RegExp(topic, "i"));
  const component = appText("PortalResources.tsx");
  assert.match(component, /No support channel is configured/);
  assert.match(component, /No message or ticket has been submitted/);
  assert.doesNotMatch(component, /mailto:|tel:|wa\.me|<form/);
});

test("role-specific privacy pages disclose data categories, access limits, and unsupported requests as drafts", () => {
  const vendorPrivacy = portalResourceSections("vendor", "privacy").map((section) => section.body).join(" ");
  const partnerPrivacy = portalResourceSections("delivery_partner", "privacy").map((section) => section.body).join(" ");
  for (const term of ["store", "prices", "stock", "bank details", "compliance", "retention", "privacy-request"])
    assert.match(vendorPrivacy, new RegExp(term, "i"));
  for (const term of ["username", "contact number", "assigned", "photograph", "retention", "privacy-request"])
    assert.match(partnerPrivacy, new RegExp(term, "i"));
  assert.ok(vendorPrivacy.includes(legalEn["legal.privacy.identity.body"]));
  assert.ok(partnerPrivacy.includes(legalEn["legal.privacy.security.body"]));
  const component = appText("PortalResources.tsx");
  assert.match(component, /Customer notice remains unchanged/);
  assert.match(component, /No request is sent by viewing this page/);
  assert.match(`${component}\n${appText("portal-resource-content.ts")}`, /passwords, authentication tokens, full bank details, private document contents/);
});

test("Account Privacy renders only the current role's returned profile values and no deletion/export controls", () => {
  const accountSections = portalResourceSections("vendor", "accountPrivacy").map((section) => section.body).join(" ");
  assert.match(accountSections, /account deletion or deactivation/);
  assert.match(accountSections, /full data export/);
  const component = appText("PortalResources.tsx");
  assert.match(component, /account\?\.storeName/);
  assert.match(component, /account\?\.displayName/);
  assert.match(component, /account\?\.username/);
  assert.match(component, /account\?\.contactNumber/);
  assert.match(component, /account\?\.status/);
  assert.doesNotMatch(component, /deleteAccount|exportAccountData|password_hash|access_token|refresh_token/);
});

test("Terms reuse existing source paragraphs and label role-specific additions for review without acceptance", () => {
  const vendorTerms = portalResourceSections("vendor", "terms");
  const partnerTerms = portalResourceSections("delivery_partner", "terms");
  assert.ok(vendorTerms.some((section) => section.body === legalEn["legal.terms.vendors.body"]));
  assert.ok(partnerTerms.some((section) => section.body === legalEn["legal.terms.partners.body"]));
  for (const section of [...vendorTerms, ...partnerTerms].filter((item) => item.draft))
    assert.match(section.title, /Draft.*review required/);
  const component = appText("PortalResources.tsx");
  assert.match(component, /No Vendor or Delivery Partner acceptance is recorded here/);
  assert.doesNotMatch(component, /acceptTerms|termsAccepted|recordAcceptance/);
});
