import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { en, te, type TranslationKey } from "../src/dictionaries";
import { localizeCustomerMessage } from "../src/customer-message";
import { translate } from "../src/translation";

const root = new URL("../../../", import.meta.url);
test("representative Customer screen copy uses the existing hook and translates both ways", () => {
  const screens = [
    ["App.tsx", "Welcome back!"],
    ["src/components/AuthControls.tsx", "Choose a new password"],
    ["src/MarketplaceScreen.tsx", "Delivering to"],
    ["src/MarketplaceScreen.tsx", "Browse eligible supermarkets and their current grocery options."],
    ["src/components/ShoppingProductDetails.tsx", "Choose an option"],
    ["src/CartScreen.tsx", "My Cart"],
    ["src/OrdersScreen.tsx", "My Orders"],
    ["src/OrdersScreen.tsx", "Clear Cart & Continue"],
    ["src/SavedItemsScreen.tsx", "Saved Items"],
    ["src/CustomerSettingsScreen.tsx", "‹ My Account"],
    ["App.tsx", "Saved Addresses"],
    ["src/HomeHistory.tsx", "Recently Ordered"],
  ] as const;
  for (const [path, key] of screens) {
    const source = readFileSync(new URL(`apps/customer/${path}`, root), "utf8");
    assert.ok(source.includes("useTranslation"), `${path}: missing existing hook`);
    assert.ok(source.includes(JSON.stringify(key)), `${path}: representative copy is disconnected`);
    assert.equal(translate("en", key), en[key]);
    assert.ok(/[\u0C00-\u0C7F]/.test(translate("te", key)), `${path}: missing Telugu`);
  }
});
test("every Customer dictionary entry has nonblank Telugu with matching interpolation parameters", () => {
  for (const key of Object.keys(en) as TranslationKey[]) {
    if (key === "common.englishFallback") continue; // Deliberate fallback fixture.
    assert.ok(te[key]?.trim(), `Missing Telugu: ${key}`);
    const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(parameters(te[key]!), parameters(en[key]), `Parameters differ: ${key}`);
    // Branding/technical tokens can legitimately be identical; namespaced keys
    // must never leak as UI. English-text keys fall back to their English copy.
    if (/^(common|auth|customer|service)\./.test(key)) {
      assert.notEqual(translate("te", key), key, `Literal key displayed: ${key}`);
    }
  }
});

test("Customer JSX has no unlocalized English text or user-facing literal attributes", () => {
  const paths = ["App.tsx", ...readdirSync(new URL("apps/customer/src/", root), { recursive: true })
    .map(path => `src/${path}`).filter(path => path.endsWith(".tsx") && !path.includes(".test."))];
  const findings: string[] = [];
  const displayAttributes = new Set(["accessibilityLabel", "placeholder", "label", "title", "confirmLabel", "cancelLabel", "message"]);
  const allowedBranding = new Set(["Apna Local Basket", "APNA LOCAL BASKET", "ALB"]);
  for (const path of paths) {
    const source = ts.createSourceFile(path, readFileSync(new URL(`apps/customer/${path}`, root), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const check = (node: ts.Node, value: string) => {
      const text = value.trim();
      if (!/[A-Za-z]{2,}/.test(text) || allowedBranding.has(text)) return;
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      findings.push(`${path}:${line + 1}: ${text}`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) check(node, node.text);
      if (ts.isJsxAttribute(node) && displayAttributes.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
        check(node, node.initializer.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(findings, [], findings.join("\n"));
});

test("canonical frontend feedback is dictionary-backed and Telugu stays in the shared catalog", () => {
  const paths = ["App.tsx", ...readdirSync(new URL("apps/customer/src/", root), { recursive: true })
    .map(path => `src/${path}`).filter(path => /\.tsx?$/.test(path) && !path.includes(".test."))];
  const messages = new Set(Object.values(en));
  const findings: string[] = [];
  for (const path of paths) {
    const text = readFileSync(new URL(`apps/customer/${path}`, root), "utf8");
    assert.ok(!/[\u0C00-\u0C7F]/.test(text), `${path}: inline Telugu bypasses shared dictionaries`);
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && /^set(Message|Error|Notice|ActionError|ProfileError|ProfileMessage|PasswordError|PasswordMessage|SlotsError)$/.test(node.expression.getText(source))) {
        const inspect = (child: ts.Node) => {
          if (ts.isStringLiteral(child) && /[A-Za-z].* /.test(child.text) && !messages.has(child.text as typeof en[keyof typeof en]) && !Object.hasOwn(en, child.text)) findings.push(`${path}: ${child.text}`);
          ts.forEachChild(child, inspect);
        };
        for (const argument of node.arguments) inspect(argument);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(findings, [], findings.join("\n"));
});

test("known service/schema messages localize without translating product names or arbitrary notes", () => {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => translate("te", key, params);
  assert.equal(localizeCustomerMessage("Use a valid six-digit Indian pincode", t), translate("te", "service.pincode"));
  assert.equal(localizeCustomerMessage("Order cannot be cancelled in its current state", t), translate("te", "service.cannotCancel"));
  assert.equal(localizeCustomerMessage("Store cannot deliver to the selected address", t), translate("te", "service.storeCannotDeliver"));
  const item = "Green Heights Milk $& (Original 1 kg)";
  const stock = `${item} is out of stock. Please review your cart.`;
  assert.equal(localizeCustomerMessage(stock, t), translate("te", "service.stockItem", { item }));
  assert.equal(localizeCustomerMessage(stock, (key, params) => translate("en", key, params)), stock);
  assert.equal(localizeCustomerMessage("Deliver beside Green Heights, Home • 505327", t), "Deliver beside Green Heights, Home • 505327");
  assert.equal(localizeCustomerMessage("From ₹12.50", t), translate("te", "service.priceFrom", { price: "₹12.50" }));
  assert.equal(localizeCustomerMessage("Too small: expected string to have >=3 characters", t), translate("te", "service.minCharacters", { count: 3 }));
});
