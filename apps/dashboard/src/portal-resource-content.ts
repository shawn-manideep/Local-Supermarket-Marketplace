import { legalEn } from "../../../packages/localization/src/legal-copy";

export type PortalResourceId = "help" | "privacy" | "accountPrivacy" | "terms";
export type PortalResourceRole = "vendor" | "delivery_partner";
export type PortalResourceSection = { title: string; body: string; draft?: boolean };

export const portalResourceItems: readonly {
  id: PortalResourceId;
  title: string;
  description: string;
  icon: "help" | "shield" | "account" | "document";
}[] = [
  { id: "help", title: "Help & Support", description: "Guides for using this portal", icon: "help" },
  { id: "privacy", title: "Privacy Policy", description: "How this role uses account and work data", icon: "shield" },
  { id: "accountPrivacy", title: "Account Privacy", description: "Your account details and available controls", icon: "account" },
  { id: "terms", title: "Terms & Conditions", description: "Current draft terms and role responsibilities", icon: "document" },
];

const vendorHelp: PortalResourceSection[] = [
  { title: "Sign-in and account access", body: "Sign in from the Vendor portal with your registered mobile number. Existing accounts can use the legacy sign-in option when needed. Use Forgot Password on the Vendor sign-in page to recover access. Vendor access and store approval are managed through the existing account process." },
  { title: "Store profile and approval", body: "Complete the required store details and keep the name, contact information, address, service PIN codes and operating hours accurate in Store Profile. Store approval and required document checks control when related operations become available." },
  { title: "Catalog and inventory", body: "Use Catalog to manage your own store listings, product details, pack sizes, prices and stock. Catalog access remains subject to the existing document approval gate. Check stock and prices before accepting and preparing orders." },
  { title: "Orders", body: "Review new orders in Orders and use the available accept, reject and preparation actions. Follow the order status shown in the portal; the Vendor portal does not perform delivery-partner pickup or delivery actions." },
  { title: "Documents, bank details and FSSAI", body: "Use Documents to review required onboarding documents, approval status and expiry notices. Keep required compliance information, including applicable FSSAI documents, and submitted bank details current. Do not send bank or document information through an unconfigured support channel." },
];

const partnerHelp: PortalResourceSection[] = [
  { title: "Sign-in and account access", body: "Delivery Partner accounts are created and managed through the existing administrator process. Use the Delivery Partner sign-in page and its Forgot Password option if you cannot access the account. An inactive account cannot use delivery operations." },
  { title: "Profile and availability", body: "Your profile details are managed by administration. Eligible delivery offers appear in the partner portal while you are signed in; review the assignment details before claiming or accepting work." },
  { title: "Accepting assignments", body: "Claim an available offer or accept a pending assignment only when you can complete it. A claim is confirmed by the server, and the assignment remains limited to the authenticated partner." },
  { title: "Pickup, package photo and status", body: "For an accepted delivery, save one clear JPEG or PNG photograph of the complete package before pickup. Then record pickup, start delivery and completion using the available status actions, and report only steps that have occurred." },
  { title: "Delivery reports", body: "Use Daily delivery report to download a PDF for an India-local date. The report is scoped to your own delivery records." },
];

const vendorPrivacy: PortalResourceSection[] = [
  { title: legalEn["legal.privacy.identity.title"], body: legalEn["legal.privacy.identity.body"] },
  { title: "Vendor account and store data", body: "The Vendor workflow uses the authenticated account and its linked store, including business contact and address details, service areas, operating hours and approval status." },
  { title: "Catalog and order activity", body: "Store product details, prices, stock changes, order actions and in-portal notifications support store operations and order fulfilment." },
  { title: "Onboarding and compliance", body: "Submitted bank details and required compliance documents, including applicable FSSAI information and expiry status, support account onboarding and administrator review. This page never displays full bank details or private document contents." },
  { title: legalEn["legal.privacy.security.title"], body: legalEn["legal.privacy.security.body"] },
  { title: "Access, retention and requests", body: "Vendor APIs scope store operations to the authenticated Vendor account; administrator functions provide separate operational oversight. The code does not establish complete retention periods, backup handling, hosting locations or a full service-provider register. User account deletion, complete data export and a privacy-request workflow are not available here." },
];

const partnerPrivacy: PortalResourceSection[] = [
  { title: legalEn["legal.privacy.identity.title"], body: legalEn["legal.privacy.identity.body"] },
  { title: "Partner account and profile", body: "The authenticated partner profile includes display name, username, contact number and account status. The partner portal displays only the profile returned for the signed-in Delivery Partner." },
  { title: "Assigned deliveries", body: "Delivery work uses assignment status and the order, store, recipient and address details needed to complete assigned deliveries. Protected API operations scope these records to the authenticated partner." },
  { title: "Package photos and reports", body: "The delivery workflow can save a package photograph and generate a date-specific report for the partner's own delivery records. This page does not expose another partner's assignment or photographs." },
  { title: legalEn["legal.privacy.security.title"], body: legalEn["legal.privacy.security.body"] },
  { title: "Access, retention and requests", body: "Administrator functions provide separate operational oversight. The code does not establish complete retention periods, backup handling, hosting locations or a full service-provider register. User account deletion, complete data export and a privacy-request workflow are not available here." },
];

const accountPrivacySections: PortalResourceSection[] = [
  { title: "What you can access", body: "This page shows only the account and role-scoped profile values already returned for your signed-in Vendor or Delivery Partner account. It does not expose passwords, authentication tokens, full bank details, private document contents or another user's information." },
  { title: "Existing controls", body: "Vendors can use the existing Store Profile, Documents, Catalog and Orders areas, subject to approval rules. Delivery Partner profile details are read-only and managed by administration. Both roles can sign out and use the password-recovery flow from their own sign-in page." },
  { title: "Unavailable privacy actions", body: "Self-service account deletion or deactivation, full data export and privacy-request submission are not supported. No request is sent or recorded from this page. A verified request channel and a retention-safe process would be needed before adding those controls; historical orders, financial records and audit history must not be silently deleted." },
];

const vendorTerms: PortalResourceSection[] = [
  { title: legalEn["legal.terms.platform.title"], body: legalEn["legal.terms.platform.body"] },
  { title: legalEn["legal.terms.vendors.title"], body: legalEn["legal.terms.vendors.body"] },
  { title: legalEn["legal.terms.listings.title"], body: legalEn["legal.terms.listings.body"] },
  { title: legalEn["legal.terms.orders.title"], body: legalEn["legal.terms.orders.body"] },
  { title: "Draft Vendor operational addition — review required", body: "Keep product information, prices and stock accurate; use the existing order actions to accept or reject orders and record preparation accurately; and keep required administrator-approved documents, applicable FSSAI information and submitted bank details current. These operational additions are proposals for business and legal review, not approved or accepted terms.", draft: true },
  { title: legalEn["legal.terms.complaints.title"], body: legalEn["legal.terms.complaints.body"] },
  { title: legalEn["legal.terms.contact.title"], body: legalEn["legal.terms.contact.body"] },
];

const partnerTerms: PortalResourceSection[] = [
  { title: legalEn["legal.terms.platform.title"], body: legalEn["legal.terms.platform.body"] },
  { title: legalEn["legal.terms.partners.title"], body: legalEn["legal.terms.partners.body"] },
  { title: legalEn["legal.terms.delivery.title"], body: legalEn["legal.terms.delivery.body"] },
  { title: legalEn["legal.terms.verification.title"], body: legalEn["legal.terms.verification.body"] },
  { title: "Draft Delivery Partner operational addition — review required", body: "Review an offer before claiming or accepting it; use customer and order details only for the assigned delivery; save the required complete-package photograph before pickup; and record pickup, delivery progress and completion accurately. Daily reports cover your own delivery records. These operational additions are proposals for business and legal review, not approved or accepted terms.", draft: true },
  { title: legalEn["legal.terms.complaints.title"], body: legalEn["legal.terms.complaints.body"] },
  { title: legalEn["legal.terms.contact.title"], body: legalEn["legal.terms.contact.body"] },
];

export function portalResourceTitle(resource: PortalResourceId) {
  return portalResourceItems.find((item) => item.id === resource)!.title;
}

export function portalResourceSections(role: PortalResourceRole, resource: PortalResourceId): readonly PortalResourceSection[] {
  switch (resource) {
    case "help": return role === "vendor" ? vendorHelp : partnerHelp;
    case "privacy": return role === "vendor" ? vendorPrivacy : partnerPrivacy;
    case "accountPrivacy": return accountPrivacySections;
    case "terms": return role === "vendor" ? vendorTerms : partnerTerms;
  }
}

export function portalResourceIntro(role: PortalResourceRole, resource: PortalResourceId) {
  switch (resource) {
    case "help":
      return "Role-specific guidance for the workflows currently available in this portal.";
    case "privacy":
      return `Draft role-specific privacy information for ${role === "vendor" ? "Vendors" : "Delivery Partners"}. The existing Customer Privacy Policy is Customer-focused and does not by itself describe these role-specific data practices.`;
    case "accountPrivacy":
      return "Review the information visible to your authenticated account and the controls currently supported. Viewing this page does not change or delete records.";
    case "terms":
      return legalEn["legal.terms.intro"];
  }
}
