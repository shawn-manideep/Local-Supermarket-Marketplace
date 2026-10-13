import type { TranslationKey } from "@workspace/localization";

export type PolicyKind = "privacy" | "terms";
export interface PolicySection {
  id: string;
  title: TranslationKey;
  body: TranslationKey;
  review?: TranslationKey;
}
export interface CustomerPolicy {
  title: TranslationKey;
  intro: TranslationKey;
  sections: readonly PolicySection[];
}

export const customerPolicies: Record<PolicyKind, CustomerPolicy> = {
  terms: {
    title: "legal.terms.title", intro: "legal.terms.intro",
    sections: [
      { id: "platform", title: "legal.terms.platform.title", body: "legal.terms.platform.body", review: "legal.terms.platform.review" },
      { id: "acceptance", title: "legal.terms.acceptance.title", body: "legal.terms.acceptance.body" },
      { id: "account", title: "legal.terms.account.title", body: "legal.terms.account.body" },
      { id: "listings", title: "legal.terms.listings.title", body: "legal.terms.listings.body", review: "legal.terms.listings.review" },
      { id: "orders", title: "legal.terms.orders.title", body: "legal.terms.orders.body" },
      { id: "delivery", title: "legal.terms.delivery.title", body: "legal.terms.delivery.body", review: "legal.terms.delivery.review" },
      { id: "verification", title: "legal.terms.verification.title", body: "legal.terms.verification.body", review: "legal.terms.verification.review" },
      { id: "payments", title: "legal.terms.payments.title", body: "legal.terms.payments.body", review: "legal.terms.payments.review" },
      { id: "returns", title: "legal.terms.returns.title", body: "legal.terms.returns.body", review: "legal.terms.returns.review" },
      { id: "vendors", title: "legal.terms.vendors.title", body: "legal.terms.vendors.body" },
      { id: "partners", title: "legal.terms.partners.title", body: "legal.terms.partners.body", review: "legal.terms.partners.review" },
      { id: "conduct", title: "legal.terms.conduct.title", body: "legal.terms.conduct.body" },
      { id: "content", title: "legal.terms.content.title", body: "legal.terms.content.body", review: "legal.terms.content.review" },
      { id: "availability", title: "legal.terms.availability.title", body: "legal.terms.availability.body", review: "legal.terms.availability.review" },
      { id: "complaints", title: "legal.terms.complaints.title", body: "legal.terms.complaints.body", review: "legal.terms.complaints.review" },
      { id: "suspension", title: "legal.terms.suspension.title", body: "legal.terms.suspension.body" },
      { id: "liability", title: "legal.terms.liability.title", body: "legal.terms.liability.body", review: "legal.terms.liability.review" },
      { id: "force", title: "legal.terms.force.title", body: "legal.terms.force.body" },
      { id: "changes", title: "legal.terms.changes.title", body: "legal.terms.changes.body", review: "legal.terms.changes.review" },
      { id: "law", title: "legal.terms.law.title", body: "legal.terms.law.body", review: "legal.terms.law.review" },
      { id: "contact", title: "legal.terms.contact.title", body: "legal.terms.contact.body" },
    ],
  },
  privacy: {
    title: "legal.privacy.title", intro: "legal.privacy.intro",
    sections: [
      { id: "identity", title: "legal.privacy.identity.title", body: "legal.privacy.identity.body", review: "legal.privacy.identity.review" },
      { id: "account", title: "legal.privacy.account.title", body: "legal.privacy.account.body" },
      { id: "address", title: "legal.privacy.address.title", body: "legal.privacy.address.body" },
      { id: "shopping", title: "legal.privacy.shopping.title", body: "legal.privacy.shopping.body" },
      { id: "sharing", title: "legal.privacy.sharing.title", body: "legal.privacy.sharing.body" },
      { id: "location", title: "legal.privacy.location.title", body: "legal.privacy.location.body" },
      { id: "device", title: "legal.privacy.device.title", body: "legal.privacy.device.body" },
      { id: "services", title: "legal.privacy.services.title", body: "legal.privacy.services.body", review: "legal.privacy.services.review" },
      { id: "security", title: "legal.privacy.security.title", body: "legal.privacy.security.body", review: "legal.privacy.security.review" },
      { id: "retention", title: "legal.privacy.retention.title", body: "legal.privacy.retention.body", review: "legal.privacy.retention.review" },
      { id: "rights", title: "legal.privacy.rights.title", body: "legal.privacy.rights.body", review: "legal.privacy.rights.review" },
      { id: "other", title: "legal.privacy.other.title", body: "legal.privacy.other.body", review: "legal.privacy.other.review" },
    ],
  },
};

export type AccountPrivacyDestination = "settings" | "addresses" | "orders" | "privacy" | "help";
export const accountPrivacySections: readonly PolicySection[] = [
  { id: "account", title: "legal.account.account.title", body: "legal.account.account.body" },
  { id: "addresses", title: "legal.account.addresses.title", body: "legal.account.addresses.body" },
  { id: "history", title: "legal.account.history.title", body: "legal.account.history.body" },
  { id: "location", title: "legal.account.location.title", body: "legal.account.location.body" },
  { id: "deletion", title: "legal.account.deletion.title", body: "legal.account.deletion.body" },
];
export const accountPrivacyActions: readonly { id: string; destination: AccountPrivacyDestination; label: TranslationKey }[] = [
  { id: "settings", destination: "settings", label: "legal.account.manageProfile" },
  { id: "addresses", destination: "addresses", label: "legal.account.manageAddresses" },
  { id: "orders", destination: "orders", label: "legal.account.viewOrders" },
  { id: "policy", destination: "privacy", label: "legal.account.readPolicy" },
  { id: "help", destination: "help", label: "legal.account.openHelp" },
];
