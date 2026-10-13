import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { legalEn, legalTe } from "../../../../packages/localization/src/legal-copy";
import { translate } from "../../../../packages/localization/src/translation";
import { accountPrivacyActions, accountPrivacySections, customerPolicies } from "./customer-policies";

const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const policyScreen = readFileSync(new URL("../CustomerPolicyScreen.tsx", import.meta.url), "utf8");
const accountScreen = readFileSync(new URL("../AccountPrivacyScreen.tsx", import.meta.url), "utf8");
const english = (key: keyof typeof legalEn) => translate("en", key);

test("all three Account entries have distinct screen destinations and back navigation", () => {
  for (const destination of ["privacy", "accountPrivacy", "terms"]) {
    assert.match(app, new RegExp(`onPress=\\{\\(\\) => navigate\\("${destination}"\\)\\}`));
    assert.match(app, new RegExp(`screen === "${destination}"`));
  }
  assert.match(app, /CustomerPolicyScreen kind="terms" onBack=\{\(\) => setScreen\("account"\)\}/);
  assert.match(app, /CustomerPolicyScreen kind="privacy" onBack=\{\(\) => setScreen\(privacyReturn\)\}/);
  assert.match(app, /if \(destination === "privacy"\) setPrivacyReturn\("accountPrivacy"\)/);
  assert.match(app, /if \(destination === "privacy"\) setPrivacyReturn\("account"\)/);
  assert.match(app, /screen === "help" \|\| screen === "privacy" \|\| screen === "accountPrivacy" \|\| screen === "terms"/);
});
test("Terms preserve all 21 source topics in their original order", () => {
  assert.deepEqual(customerPolicies.terms.sections.map(section => section.id), [
    "platform", "acceptance", "account", "listings", "orders", "delivery", "verification",
    "payments", "returns", "vendors", "partners", "conduct", "content", "availability",
    "complaints", "suspension", "liability", "force", "changes", "law", "contact",
  ]);
  assert.ok(customerPolicies.terms.sections.every(section => section.title && section.body));
  assert.match(legalEn["legal.terms.intro"], /TERMS.docx/);
  assert.doesNotMatch(Object.values(legalEn).join("\n"), /Blinkit|7801080990|mailto:|tel:/);
});
test("Terms identify unconfirmed business details and source deadlines rather than adopting them", () => {
  assert.match(legalEn["legal.terms.platform.review"], /registered operator.*unconfirmed/);
  assert.match(legalEn["legal.terms.returns.review"], /two-day.*unconfirmed/);
  assert.match(legalEn["legal.terms.complaints.review"], /proposed seven-day/);
  assert.match(legalEn["legal.terms.payments.review"], /Schedule is not approved/);
  assert.match(legalEn["legal.terms.law.review"], /no venue has been invented/);
  assert.match(legalEn["legal.terms.changes.review"], /No effective\/last-updated date/);
  assert.match(policyScreen, /t\("legal.draftNotice"\)/);
  assert.match(policyScreen, /section\.review/);
});
test("Terms preserve mandatory consumer protections and do not introduce blanket liability exclusions", () => {
  assert.match(legalEn["legal.terms.liability.body"], /Nothing excludes or limits liability where prohibited by law/);
  assert.match(legalEn["legal.terms.liability.body"], /fraud, wilful misconduct/);
  assert.match(legalEn["legal.terms.returns.body"], /lack of a photograph must not automatically defeat a legally valid claim/);
  assert.match(legalEn["legal.terms.law.body"], /retain the ability to approach a competent consumer commission/);
  assert.match(legalEn["legal.terms.liability.review"], /No new cap or blanket waiver/);
});
test("Terms limit descriptions to implemented COD, cancellation, delivery and handover capabilities", () => {
  assert.match(legalEn["legal.terms.payments.body"], /Cash on Delivery.*not online or wallet/);
  assert.match(legalEn["legal.terms.returns.body"], /only while an order is Placed/);
  assert.match(legalEn["legal.terms.verification.body"], /does not request.*OTPs/);
  assert.match(legalEn["legal.terms.verification.review"], /future requirements, not implemented guarantees/);
  assert.match(legalEn["legal.terms.delivery.body"], /one-hour slots today or tomorrow in India time/);
  assert.match(legalEn["legal.terms.content.body"], /does not offer public ratings, reviews or content uploads/);
});
test("Privacy covers verified data uses, fulfilment sharing, storage and unresolved practices", () => {
  assert.equal(customerPolicies.privacy.sections.length, 12);
  assert.match(legalEn["legal.privacy.account.body"], /username.*authentication email/);
  assert.match(legalEn["legal.privacy.address.body"], /snapshot/);
  assert.match(legalEn["legal.privacy.shopping.body"], /cart items.*saved store-product listings/);
  assert.match(legalEn["legal.privacy.sharing.body"], /assigned delivery partner/);
  assert.match(legalEn["legal.privacy.device.body"], /preference storage is separate/);
  assert.match(legalEn["legal.privacy.services.body"], /Supabase/);
  assert.match(legalEn["legal.privacy.security.body"], /request IP\/network address for rate limiting/);
  assert.match(legalEn["legal.privacy.retention.review"], /No retention duration or guarantee of complete deletion/);
  assert.match(legalEn["legal.privacy.other.body"], /No promise is made that data is sold or never sold/);
});
test("Account Privacy actions navigate to existing controls and unsupported requests show honest notices", () => {
  assert.deepEqual(accountPrivacyActions.map(action => action.destination), ["settings", "addresses", "orders", "privacy", "help"]);
  assert.equal(accountPrivacySections.length, 5);
  assert.match(accountScreen, /onNavigate\(action\.destination\)/);
  assert.match(accountScreen, /onPress=\{\(\) => setRequestNoticeVisible\(true\)\}/);
  assert.match(accountScreen, /t\("legal.account.requestUnavailable"\)/);
  assert.match(legalEn["legal.account.requestUnavailable"], /No request has been sent/);
  assert.match(legalEn["legal.account.deletion.body"], /No safe Customer self-service account deletion/);
  assert.doesNotMatch(accountScreen, /customerApi|fetch\(|supabase|useEffect|Linking|deleteAccount|setSession/);
  assert.doesNotMatch(policyScreen, /customerApi|fetch\(|supabase|useEffect|Linking|deleteAccount/);
});
test("location guidance never requests permissions or fabricates tracking", () => {
  assert.match(legalEn["legal.privacy.location.body"], /does not request device GPS permission/);
  assert.match(legalEn["legal.account.location.body"], /browser's site permissions or device app settings/);
  assert.doesNotMatch(accountScreen + policyScreen, /getCurrentPosition|requestPermissions|openSettings\(/);
});
test("all legal and privacy keys have complete natural Telugu translations and live bindings", () => {
  const keys = Object.keys(legalEn) as Array<keyof typeof legalEn>;
  assert.ok(keys.length > 100);
  assert.deepEqual(Object.keys(legalTe).sort(), keys.slice().sort());
  for (const key of keys) {
    assert.ok(legalTe[key]?.trim(), key);
    assert.notEqual(legalTe[key], english(key), key);
    assert.match(translate("te", key), /[\u0C00-\u0C7F]/, key);
  }
  for (const screen of [accountScreen, policyScreen]) {
    assert.match(screen, /useTranslation\(\)/);
    assert.match(screen, /CustomerLanguageSelector labelKey="customer.language"/);
    assert.doesNotMatch(screen, /key=\{(?:language|locale)/);
  }
});
test("long policy content and actions use mobile-safe scrolling and accessible controls", () => {
  for (const screen of [accountScreen, policyScreen]) {
    assert.match(screen, /<ScrollView/);
    assert.match(screen, /contentContainerStyle=\{commonStyles.page\}/);
    assert.match(screen, /accessibilityRole="button"/);
    assert.match(screen, /flexShrink: 1/);
  }
  assert.match(accountScreen, /minHeight: 48/);
  assert.match(accountScreen, /accessibilityLiveRegion="polite"/);
  assert.match(policyScreen, /minHeight: 44/);
});
