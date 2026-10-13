import type { TranslationKey } from "@workspace/localization";

export const helpCategories = [
  { id: "account", label: "help.category.account", icon: "♙" },
  { id: "orders", label: "help.category.orders", icon: "▤" },
  { id: "payments", label: "help.category.payments", icon: "₹" },
  { id: "wallet", label: "help.category.wallet", icon: "▱" },
  { id: "general", label: "help.category.general", icon: "ⓘ" },
] as const satisfies ReadonlyArray<{ id: string; label: TranslationKey; icon: string }>;

export type HelpCategoryId = typeof helpCategories[number]["id"];
export interface HelpTopic {
  id: string;
  category: HelpCategoryId;
  question: TranslationKey;
  answer: TranslationKey;
}
export const helpTopics = [
  { id: "track", category: "orders", question: "help.faq.track.question", answer: "help.faq.track.answer" },
  { id: "address", category: "orders", question: "help.faq.address.question", answer: "help.faq.address.answer" },
  { id: "refund", category: "payments", question: "help.faq.refund.question", answer: "help.faq.refund.answer" },
  { id: "profile", category: "account", question: "help.faq.profile.question", answer: "help.faq.profile.answer" },
  { id: "scheduled", category: "orders", question: "help.faq.scheduled.question", answer: "help.faq.scheduled.answer" },
  { id: "missing", category: "orders", question: "help.faq.missing.question", answer: "help.faq.missing.answer" },
  { id: "cancel", category: "orders", question: "help.faq.cancel.question", answer: "help.faq.cancel.answer" },
  { id: "payment", category: "payments", question: "help.faq.payment.question", answer: "help.faq.payment.answer" },
  { id: "wallet", category: "wallet", question: "help.faq.wallet.question", answer: "help.faq.wallet.answer" },
  { id: "language", category: "general", question: "help.faq.language.question", answer: "help.faq.language.answer" },
] as const satisfies ReadonlyArray<HelpTopic>;

export function filterHelpTopics(query: string, category: HelpCategoryId | null, translate: (key: TranslationKey) => string): HelpTopic[] {
  const words = query.normalize("NFKC").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return helpTopics.filter(topic => {
    if (category && topic.category !== category) return false;
    const label = helpCategories.find(item => item.id === topic.category)!.label;
    const text = [translate(topic.question), translate(topic.answer), translate(label)].join(" ").normalize("NFKC").toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}

export function toggleHelpQuestion(current: string | null, next: string): string | null {
  return current === next ? null : next;
}

/** No central support channel is configured: never simulate a sent message. */
export function supportNotice(action: "chat" | "contact"): TranslationKey {
  return action === "chat" ? "help.chatUnavailable" : "help.contactUnavailable";
}
