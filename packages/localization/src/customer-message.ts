import { en, type TranslationKey } from "./dictionaries";
import type { TranslationFunction } from "./translation";

// An exact allowlist of interface messages; this is not a general translator.
const knownMessages = new Map<string, TranslationKey>();
for (const key of Object.keys(en) as TranslationKey[]) {
  if (!knownMessages.has(en[key])) knownMessages.set(en[key], key);
}

/** Render canonical messages/keys in the CURRENT language, not the request's language. */
export function localizeCustomerMessage(message: string, t: TranslationFunction): string {
  if (!message) return "";
  const key = knownMessages.get(message);
  if (key) return t(key);
  if (Object.prototype.hasOwnProperty.call(en, message)) return t(message as TranslationKey);
  // Fixed server templates only. The item prefix remains verbatim, never translated.
  const templates = [
    [" is out of stock. Please review your cart.", "service.stockItem"],
    [" is no longer available in the selected quantity. Please reduce the quantity in your cart.", "service.stockQuantityItem"],
    [": choose a whole quantity between 1 and 999.", "service.stockInvalidItem"],
    [" is no longer available. Please review your cart.", "service.stockUnavailableItem"],
  ] as const;
  for (const [suffix, template] of templates) {
    if (message.endsWith(suffix) && message.length > suffix.length) {
      return t(template, { item: message.slice(0, -suffix.length) });
    }
  }
  const fromPrice = /^From (₹[\d,.]+)$/.exec(message);
  if (fromPrice) return t("service.priceFrom", { price: fromPrice[1] });
  // Zod's stable string length diagnostics contain bounds, not user input.
  const bound = /^Too (small|big): expected string to have (?:>=|<=)(\d+) characters$/.exec(message);
  if (bound) return t(bound[1] === "small" ? "service.minCharacters" : "service.maxCharacters", { count: bound[2] });
  return message; // Arbitrary server text/notes are opaque and preserved.
}
