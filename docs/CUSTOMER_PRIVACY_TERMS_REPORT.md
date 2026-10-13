# Customer Privacy and Terms — Implementation Report

## Scope and access

Added three distinct destinations under **Account & Settings**:

- **Privacy Policy** — verified data practices and unresolved operational details.
- **Account Privacy** — concise capability guidance and existing working controls.
- **Terms & Conditions** — all 21 substantive topics from the supplied
  `attached_assets/0_TERMS_1791893077723.docx`.

Each entry has a labelled, accessible button and icon. The Account tab remains
selected on the new pages. Back returns to Account; when Privacy Policy is
opened from Account Privacy, Back returns to Account Privacy instead.

The policy renderer is shared, but Privacy Policy and Terms have separate
destinations and content. There are no duplicate routes for those destinations.

## Exact files and components

### Application and tests

1. `apps/customer/App.tsx` — imports, three Account menu entries, three screen
   states, contextual Privacy Policy return destination and Account-tab state.
2. `apps/customer/src/CustomerPolicyScreen.tsx` — shared long-form policy
   renderer and `PolicyBackButton`; draft banner, source section headings and
   confirmation notes.
3. `apps/customer/src/AccountPrivacyScreen.tsx` — separate capability summary,
   navigation actions and a truthful privacy-request availability notice.
4. `apps/customer/src/lib/customer-policies.ts` — typed policy-section manifests,
   stable identifiers and supported Account Privacy destinations.
5. `apps/customer/src/lib/customer-policies.test.ts` — ten focused tests.
6. `packages/localization/src/legal-copy.ts` — **113 English and 113 Telugu**
   strings for all new content and controls.
7. `packages/localization/src/dictionaries.ts` — merges the new Customer-only
   legal catalogue into the existing dictionaries.

### Documentation and project guidance

8. `docs/CUSTOMER_PRIVACY_TERMS_REPORT.md` — this report.
9. `.agents/memory/customer-legal-review-boundaries.md` — the user's durable
   approval, consumer-protection and safe-deletion constraints.
10. `.agents/memory/MEMORY.md` — pointer to those constraints.

No API, schema, database migration, dependency, authentication, authorization,
stock, pricing, cart processing, order processing or delivery workflow was
changed. No Vendor, Delivery Partner or Admin portal was modified.

## Source Terms incorporation and adaptations

The supplied document contains 21 Terms sections; its heading mentions Privacy
Policy, but it does not supply a separate completed privacy-policy text.
Privacy Policy was therefore drafted separately from verified application code.

| Source section | Customer-page treatment |
|---|---|
| 1. Platform | Local Basket name and current store/order/delivery functions; registered operator, address and legal facilitator role explicitly unconfirmed. |
| 2. Acceptance/eligibility | Accurate details, lawful use, contractual capacity and adult/minor responsibilities retained; no claim this draft records acceptance. |
| 3. Account/login | Account/device/password responsibilities retained; supported profile/password controls described; no fictional verification service or contact. |
| 4. Listings/pack sizes/prices | Variant versus pack quantity, INR prices, stock recheck and accepted snapshots retained. Current delivery/handling charges described; tax, promotions, extra fees and listing-error remedies flagged. No silent-substitution permission. |
| 5. Orders/acceptance | Store acceptance/rejection and actual status progression described; unimplemented Customer self-pickup/refund status workflows not promised. Consumer refund rights retained. |
| 6. Delivery/addresses | Recipient/address responsibility, delays and authorised recipient retained. Entered-address/PIN use, immutable order addresses and future one-hour India-time scheduled slots described. Failed-delivery process flagged. |
| 7. Handover verification | Store-to-partner pickup/delivery events described. Source OTP verification, expiry, single-use and rate limits explicitly retained as unimplemented future requirements, not guarantees. |
| 8. Payments/charges/invoices/refunds | COD only, accepted charges and mandatory consumer protections retained. No online processor or automated refund claim; incomplete refund schedule and invoice/tax responsibilities flagged. |
| 9. Cancellations/returns/perishables | Current Placed-only cancellation described. Safety, evidence and non-waivable rights retained. Unconfirmed two-day reporting rule/contact and return/replacement decisions not adopted. |
| 10. Vendors | Lawful listings, product quality, food safety, licences, invoices and restricted Customer-data use retained; no compliance-certification claim. |
| 11. Partners | Confidentiality, safety, appropriate handling and truthful event recording retained; contractor/employment status, insurance and checks flagged. |
| 12. Conduct | False information, abuse, unauthorised access, malicious code, fraudulent orders and unlawful goods prohibitions retained. |
| 13. Reviews/content | Truthfulness, privacy, contributor ownership and lawful criticism retained. No current public-content feature promised; source non-exclusive worldwide royalty-free operating/improvement/promotion licence explicitly a review proposal. |
| 14. Availability/IP | Interruptions and lawful ownership/licensing protections retained; operator/IP ownership still requires confirmation. |
| 15. Complaints | Statutory redress preserved. Source contact, hours and seven-day targets flagged; no fabricated ticket or functioning grievance workflow. |
| 16. Suspension/termination | Proportionate restrictions, lawful notice/challenge and pending-record obligations retained; no self-service account deletion created. |
| 17. Liability | Platform/store statutory duties, consumer rights, fraud/wilful-misconduct and other non-excludable liabilities retained. No new liability cap or blanket waiver. |
| 18. Force majeure | Source examples and permitted-law scope retained; no automatic waiver of non-excludable duties. |
| 19. Changes | Real approved date, notice and legally required consent principles retained; no generated date or passive-consent mechanism. |
| 20. Law/disputes | Source Indian-law proposal and mandatory consumer jurisdiction preserved. Blank city/state remains unresolved; no venue invented. |
| 21. Contacts | Operator, office, customer support, grievance and privacy representative explicitly awaiting confirmation. |

Incorrect Blinkit branding was removed from displayed content. Local Basket is
used as the verified interface brand, **not** as a confirmed registered entity.

## Unresolved business and legal decisions

The following require owner confirmation and qualified legal review:

- Registered operator name, registered/principal address and actual legal
  marketplace role/responsibility allocation.
- Whether the source phone **7801080990** is the current official Customer
  support contact; its **10:00am–5:00pm** hours are also unconfirmed.
  The number is **not displayed or activated as an official contact**.
- The source's **two-day** missing/incorrect/damaged-item reporting window and
  proposed **seven-day** complaint acknowledgement/resolution targets.
  They are identified as proposals rather than adopted deadlines.
- Complaint intake/reference process and grievance-officer name, designation,
  postal address, email and phone.
- Tax treatment, statutory invoice issuer/content, cash-refund method and
  targets; unavailable-item, perishable, return/replacement, preparation-stage
  cancellation and failed-delivery procedures.
- Privacy representative/contact, applicable rights processes, identity
  verification, lawful response periods, retention and backup/deletion rules.
- Production hosting/provider register, processing locations/transfers,
  contractual safeguards, operational logs, marketing/analytics practices and
  applicable legal bases/consent requirements.
- Partner status, insurance/checks, IP/content licence scope, any additional
  liability limitations, dispute venue, policy-change/consent procedure and
  genuine effective dates.

No effective or last-updated date was invented. The pages prominently state
that they are informational drafts. They are **not publication-ready legal
documents** and do not replace qualified legal advice.

## Privacy Policy grounding

The policy draws on these inspected implementation facts:

| Verified practice | Implementation evidence |
|---|---|
| Customer identity/profile | Customer App account flow and `backend/api/src/customer-settings/routes.ts`: username, authentication email, name/phone and verified password change. |
| Authentication/session persistence | `apps/customer/src/lib/supabase.ts`: Supabase Auth, persisted AsyncStorage session, token refresh. |
| Language preference isolation | `apps/customer/src/lib/language-storage.ts` and existing localization preferences: separate account/signed-out scoped local preference storage. |
| Saved address/recipient fields | Existing `AddressesScreen`, Customer address DTO and order creation snapshot fields. |
| Cart/saved listings/order data | Existing Customer cart, Saved Items and order routes/UI; accepted item, price/fee, address, recipient, schedule and status records. |
| Fulfilment sharing | `backend/api/src/orders/routes.ts` and `backend/api/src/delivery-partner/repository.ts`: relevant store/assigned-partner order and recipient/address access. |
| Network information/security | `backend/api/src/security.ts` and existing authenticated/ownership-scoped routes: request IP/network address for rate limiting. |
| No Customer GPS request | Inspected Customer application has entered-address/PIN selection, with no device geolocation or location-permission call. |
| Unsupported deletion/request flows | Existing Customer controls/routes have no complete Customer account deletion/deactivation, data-export or privacy-request submission workflow. |

Supabase authentication/database usage is disclosed. Unknown hosting contracts,
provider/transfer register, persistent-log policy, retention periods, advertising,
marketing and data-sale practices are flagged rather than invented. The text
makes no blanket encryption, security, data-sale or complete-erasure guarantee.

## Functional Account Privacy controls

- **Manage profile & password** → existing Settings.
- **Manage saved addresses** → existing Delivery Addresses.
- **View order history** → existing Orders.
- **Read Privacy Policy** → Privacy Policy, with contextual Back.
- **Open Help & Support** → existing Help screen.
- **Privacy & data request information** → a translated in-app message stating
  no official privacy route is configured and no request has been sent.

There is no account-delete/deactivate/export mutation or pretend submission.
Location guidance points to browser/device settings without requesting or
changing permissions. Merely opening any of the new screens performs no record
mutation.

## English/Telugu and mobile presentation

All **113** new titles, sections, body paragraphs, review notes, action labels
and unavailable-request messages have English and Telugu entries. Existing
translation provider, saved preference and font/typography components are reused.
Each new screen reuses the existing language selector for immediate updates.
Account Privacy request-notice state remains local and intact when language
changes; no locale-dependent remount key is used.

Shared scrolling/container/bottom-padding conventions, wrapping text and 44px+
controls are retained. There is a Back button at the beginning and end of long
policy pages. Policy section titles are not truncated into unreadable headings.

## Verification

| Check | Result |
|---|---|
| Customer regression + focused tests | **86 passed, 0 failed**, including 10 new policy/privacy tests |
| Existing localization tests | **25 passed, 0 failed** |
| Shared-library typecheck | **Passed** |
| Customer typecheck | **Passed** |
| Customer Expo web export | **Passed**, 481 modules, 1.6 MB bundle |
| Managed Customer preview | **Running after restart** |
| 390px public preview screenshot | Existing sign-in screen renders; not authenticated policy-screen acceptance evidence |

```sh
pnpm --filter @workspace/api exec tsx \
  --tsconfig ../../apps/customer/tsconfig.json --test \
  ../../apps/customer/src/lib/*.test.ts \
  ../../apps/customer/src/home-marketplace.test.ts \
  ../../apps/customer/src/marketplace-scrolling.test.ts
pnpm --filter @workspace/localization test
pnpm run typecheck:libs
pnpm --filter @workspace/customer typecheck
```

The export used the existing `artifacts/marketplace-customer: web` workflow and
`/tmp/phase12-customer-web` output. A style-spread type error found on the first
Customer typecheck was corrected; the final typecheck passes.

Focused tests cover model behavior/content safety and component/navigation
wiring; no automated signed-in browser journey test was performed. The public
preview continues to log a resource 404 and the existing password-form advisory
while rendering sign-in. This is not evidence of signed-in acceptance.

## Manual acceptance checks

1. Sign in and open each of the three Account & Settings entries. Confirm a
   distinct page, readable title, Account-tab selection and working Back.
2. From Account Privacy, open Privacy Policy and confirm Back returns to Account
   Privacy; from the Account menu, confirm Privacy Policy Back returns to Account.
3. Scroll Terms through all 21 headings and Privacy through all 12 sections.
   Confirm draft banners, consumer-rights language and visible review notes.
4. Switch English/Telugu on each page. Confirm all body/review/action text updates;
   an open Account Privacy request notice remains visible and translates.
5. Exercise each Account Privacy navigation action. Tap request information and
   confirm the message says no request was sent. There must be no deletion/export
   or account-change side effect from opening the page.
6. Check 320–414px widths and desktop: paragraphs/headings/buttons wrap, no
   horizontal overflow, and final content remains above bottom navigation.
7. Confirm that registered business/address, the source phone/hours, reporting
   deadlines, refund guarantees, handover OTPs, venues and effective dates are not
   presented as verified operational commitments.

The application was **not deployed or published**.
