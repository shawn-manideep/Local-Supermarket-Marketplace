import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { en, te, type TranslationKey } from "../../../../packages/localization/src/dictionaries";
import { translate } from "../../../../packages/localization/src/translation";
import { filterHelpTopics, helpCategories, helpTopics, supportNotice, toggleHelpQuestion } from "./help-support";

const english = (key: TranslationKey) => translate("en", key);
const telugu = (key: TranslationKey) => translate("te", key);
const screen = readFileSync(new URL("../HelpSupportScreen.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

test("Account Help entry opens the dedicated screen and back returns to Account", () => {
  assert.match(app, /onPress=\{\(\) => navigate\("help"\)\}/);
  assert.match(app, /screen === "help"[\s\S]*?<HelpSupportScreen onBack=\{\(\) => setScreen\("account"\)\}/);
  assert.match(app, /screen === "settings" \|\| screen === "help"/);
  assert.match(screen, /onPress=\{onBack\}/);
});
test("every category exposes real topics and filters do not invent wallet capabilities", () => {
  assert.equal(helpCategories.length, 5);
  for (const category of helpCategories) {
    const results = filterHelpTopics("", category.id, english);
    assert.ok(results.length > 0);
    assert.ok(results.every(topic => topic.category === category.id));
  }
  const wallet = filterHelpTopics("", "wallet", english);
  assert.match(english(wallet[0].answer), /does not currently offer a wallet/);
  assert.match(screen, /setCategory\(selected \? null : item\.id\)/);
});
test("search matches questions, answers and categories, trims case, combines words and handles empty results", () => {
  assert.deepEqual(filterHelpTopics("  TRACK  ", null, english).map(topic => topic.id), ["track"]);
  assert.ok(filterHelpTopics("status history", null, english).some(topic => topic.id === "track"));
  assert.ok(filterHelpTopics("account & profile", null, english).some(topic => topic.category === "account"));
  assert.equal(filterHelpTopics("track", "payments", english).length, 0);
  assert.equal(filterHelpTopics("zzzz-not-a-help-topic", null, english).length, 0);
  assert.equal(filterHelpTopics("   ", null, english).length, helpTopics.length);
  assert.match(screen, /t\("help.noResults"\)/);
  assert.match(screen, /onChangeText=\{setQuery\}/);
});
test("FAQ toggles open, closed and another question using stable identities", () => {
  assert.equal(toggleHelpQuestion(null, "track"), "track");
  assert.equal(toggleHelpQuestion("track", "track"), null);
  assert.equal(toggleHelpQuestion("track", "refund"), "refund");
  assert.match(screen, /toggleHelpQuestion\(current, topic\.id\)/);
  assert.match(screen, /accessibilityState=\{\{ expanded \}\}/);
  assert.match(screen, /expanded &&/);
});
test("all Help labels and FAQ content have distinct English/Telugu translations", () => {
  const keys = Object.keys(en).filter(key => key.startsWith("help.")) as TranslationKey[];
  assert.equal(keys.length, 40);
  for (const key of keys) {
    assert.ok(te[key]?.trim(), `missing Telugu ${key}`);
    assert.notEqual(english(key), telugu(key), `untranslated ${key}`);
    assert.match(telugu(key), /[\u0C00-\u0C7F]/);
  }
  assert.equal(translate("te", "help.questionsCount", { count: 3 }), "3 సహాయ అంశాలు");
  assert.ok(filterHelpTopics("వాలెట్", "wallet", telugu).length > 0);
  assert.ok(filterHelpTopics("పాస్‌వర్డ్", "account", telugu).length > 0);
  assert.match(screen, /const \{ t \} = useTranslation\(\)/);
  assert.match(screen, /<CustomerLanguageSelector labelKey="customer.language"/);
  assert.match(screen, /\[query, category, t\]/);
  assert.doesNotMatch(screen, /key=\{(?:language|locale)/);
});
test("support buttons show honest localized notices, without external or fabricated channels", () => {
  assert.equal(supportNotice("chat"), "help.chatUnavailable");
  assert.equal(supportNotice("contact"), "help.contactUnavailable");
  assert.match(english(supportNotice("chat")), /No message has been sent/);
  assert.match(english(supportNotice("contact")), /have not been configured/);
  assert.match(screen, /showSupportNotice\("chat"\)/);
  assert.match(screen, /showSupportNotice\("contact"\)/);
  assert.match(screen, /t\(supportNotice\(notice\)\)/);
  assert.doesNotMatch(screen, /fetch\(|customerApi|Linking|mailto:|tel:|wa\.me|24\/7/);
});
test("help content accurately limits order, payment and address functionality", () => {
  assert.match(english("help.faq.payment.answer"), /Cash on Delivery/);
  assert.match(english("help.faq.refund.answer"), /does not offer an in-app refund/);
  assert.match(english("help.faq.cancel.answer"), /only while the order is Placed/);
  assert.match(english("help.faq.track.answer"), /not a live delivery map/);
  assert.match(english("help.faq.address.answer"), /does not change.*already placed/);
  assert.match(english("help.faq.scheduled.answer"), /one-hour slot.*Today or Tomorrow/);
});
test("Help uses scroll containment, bottom padding and accessible touch targets", () => {
  assert.match(screen, /<ScrollView/);
  assert.match(screen, /contentContainerStyle=\{commonStyles.page\}/);
  assert.match(screen, /minHeight: 44/);
  assert.match(screen, /keyboardShouldPersistTaps="handled"/);
  assert.match(screen, /flexWrap: "wrap"/);
});
