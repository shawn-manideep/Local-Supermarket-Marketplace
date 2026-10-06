# Authentication and Portal UI Implementation Report

## Status and scope

Implemented in the development workspace using the existing Supabase Auth, shared username registry, API routes, portal components, design tokens, and delivery/order workflows.

No deployment or automated browser tests were performed. No account passwords were changed for testing, and no real-user recovery messages were deliberately sent. Unrelated existing TypeScript errors were not repaired.

Email delivery, provider redirect configuration, and the manual acceptance checklist below remain to be verified. One existing Vendor and one Delivery Partner use non-deliverable placeholder Auth email addresses; their email recovery cannot deliver until an approved real recovery contact is registered. No contact information was invented and no existing identity was replaced.

## 1. Customer username authentication and compatibility

- Customer sign-in now collects **Username + Password**, not email.
- The new login API resolves the existing shared username binding and signs into the original Supabase account. It returns session tokens, not an email or identity record.
- Case normalization and the existing ASCII/reserved-name rules are shared with Vendor/Delivery Partner provisioning.
- Wrong-role usernames, unknown usernames, wrong passwords, and mismatched provider identities cannot grant Customer access.
- The Customer application verifies the restored session through the existing `/api/auth/me` endpoint before mounting the shopping portal. Inactive or wrong-role sessions receive an access-denied/sign-out screen.
- Passwords remain transient form state and are cleared after submission or leaving the login form.

### Existing account migration

Applied forward-only migration `0018_customer_usernames` through the established Supabase migration history.

The user approved normalized existing email prefixes for the 11 Customers without usernames. Invalid characters become underscores, non-letter/short/reserved prefixes are adjusted, long prefixes are shortened, and collisions receive bounded numeric suffixes. The same global registry and username locking namespace are used.

Verified after migration:

| Check | Result |
|---|---|
| Existing Customers with usernames | **11 / 11** |
| Invalid generated username formats | **0** |
| Existing Supabase Auth rows, including password hashes | **Unchanged** |
| Existing Vendor/Partner username bindings | **Unchanged** |
| Protected operational tables | **Unchanged** |

Assigned usernames are available through existing Admin Customer management. Existing Customers must use their assigned username and original password; accounts and passwords were not recreated.

### New Customer registration

Registration collects a chosen username, recovery email, and password using the existing Supabase signup path. Explicit Customer signup metadata reserves the username atomically in the existing Auth creation trigger. Invalid/reserved/taken names roll back registration.

Email remains a **registration/recovery contact only**, not a Customer login/recovery input.

Admin-created Vendor/Partner Auth identities do not automatically reserve Customer usernames. This preserves the existing temporary Customer-shell-to-partner provisioning sequence and immutable username bindings.

## 2. Shared password visibility and Forgot Password

| Portal | Sign-in identity retained | Recovery input |
|---|---|---|
| Customer | Username | Username |
| Vendor | Existing email **or** Vendor username | Email or Vendor username |
| Delivery Partner | Username | Username |
| Admin | Existing email | Email |

All four portals have an in-field eye control, hidden by default, with accessible Show/Hide password labels. Toggling does not submit the form.

The three React dashboard portals reuse `PasswordInput`, `ForgotPassword`, and `ResetPassword`. The Expo Customer portal uses native adapters. Both implementations reuse the same password visibility contract, username validator, reset-password validator, and generic recovery confirmation.

Recovery forms are outside dashboard sign-in forms, avoiding nested HTML forms.

## 3. Secure recovery and reset completion

`POST /api/auth/recovery` accepts only `{ role, identity }`.

- Resolves the contact internally using the existing role and username/email associations.
- Never returns the resolved contact, user ID, account status, reset link, provider diagnostic, or token.
- Known, unknown, wrong-role, non-deliverable, and provider-failure outcomes use the same generic confirmation.
- Unknown/wrong-role/placeholder requests use a synthetic non-deliverable provider identity rather than revealing existence.
- Uses Supabase's existing `resetPasswordForEmail` and authenticated `updateUser({ password })`; no custom reset-token table, password storage, or second authentication system was added.
- Requires an origin already allowed by `CORS_ALLOWED_ORIGINS`; a caller cannot supply an arbitrary redirect URL.
- Uses the existing trusted proxy configuration for IP-based, per-role throttling: five requests per 15 minutes, with a bounded in-memory limiter and `Retry-After`.
- Initiates provider recovery separately from the fixed 1.2-second response delay, so delivery/provider latency does not determine the confirmation timing.
- Recovery and Customer login responses are marked `Cache-Control: no-store`.
- Both applications recognize `PASSWORD_RECOVERY`, consume the provider session, remove URL credential fragments through the SDK/history handling, and show the reset form before their normal portal.
- Reset completion validates an 8–128-character password and matching confirmation, updates the authenticated account, clears password fields, signs out, and returns to sign-in.
- Invalid/expired sessions cannot reset an unauthenticated account. Provider failures use safe retry messages.

### Redirects

The server derives URLs from the approved origin and registered artifact paths:

- Customer: `/customer/?recovery=1`
- Vendor: `/?recovery=1`
- Admin: `/admin?recovery=1`
- Delivery Partner: `/delivery-partner?recovery=1`

These URLs must be in the Supabase Auth redirect allowlist, and the email provider must be configured for actual delivery. No Supabase SMTP/site configuration or production configuration was changed. Delivery is not claimed merely because the generic endpoint returned HTTP 202.

Native clients use the same account and a web recovery completion URL; native custom-scheme recovery links were not introduced.

## 4. One Customer product/store search

- Removed the dedicated supermarket search field and its independent state.
- One global **Search products or stores** component/query is used on Home, global results, and store browsing.
- Product results continue using the existing debounced, paginated `/api/customer/products` read API.
- Matching stores are derived from the existing saved-pincode-eligible active-store directory and displayed beside product results.
- Opening a matching store clears global search and uses the existing store-selection/catalog navigation.
- Category browsing remains available without a mandatory category selection.
- Store-directory loading/freshness checks prevent showing a previous address's stores.
- Search matching uses public names; no SKU/internal ID/owner contact is added to public results.
- Existing product projections, category/availability/visibility rules, variants, carts, addresses, orders, and reorder behavior are unchanged.

The existing store-directory cap of 100 eligible stores is unchanged; this implementation does not introduce a second store-search backend or expand the directory API.

## 5. Vendor Delivery navigation removal

- Removed the Vendor-only Delivery tab, tab type, and dedicated Delivery rendering branch.
- The READY/delivery summary now opens the existing **Orders** tab.
- Existing order details, preparation actions, delivery status information, Partner assignment, and backend delivery endpoints remain.
- Legacy direct `/delivery` and `/vendor/delivery` paths normalize to the Vendor root after Vendor role verification. This does not intercept Admin or `/delivery-partner` routes.
- No Customer/Admin/Delivery Partner navigation was removed.

## 6. Delivery Partner dashboard: UI only

Improved the existing dashboard with:

- Time-of-day greeting and existing Partner display name.
- Existing live total/pending/in-progress/completed counters.
- Full original status breakdown and stable test identifiers.
- Existing recent delivery rows, readable badges, View delivery, and View all deliveries actions.
- Existing loading, empty, error, retry, detail, sign-out, and profile behavior.
- Responsive layouts using the current palette, shared tokens, and Inter typography.

The existing dashboard API counters are all-time assignment totals, **not date-filtered totals**. They are labelled accordingly instead of presenting them as “today” counts.

The original 45-second polling, action guards, ownership checks, accept/reject/pickup/start/deliver actions, status transitions, and assignment/order locking are unchanged. No mock deliveries, fabricated metrics, or delivery workflow/schema changes were added.

## 7. Files and API changes

### Authentication/backend

- `backend/api/src/auth/account-access.ts` — Customer login and role-aware generic Supabase recovery.
- `backend/api/src/auth/routes.ts` — Customer login/recovery endpoints, origin/limiter/timing handling.
- `backend/api/src/auth/account-access.test.ts` — authentication/privacy/route security checks.
- `backend/api/src/auth/customer-usernames.integration.test.ts` — isolated PostgreSQL migration/signup compatibility checks.
- `database/migrations/0018_customer_usernames.sql` — forward-only username backfill and explicit Customer signup reservation.
- `packages/validation/src/index.ts` — shared reset-password validation and recovery confirmation.
- `packages/constants/src/index.ts` — shared password visibility contract.

### Customer

- `apps/customer/App.tsx` — username sign-in, registration compatibility, recovery/session/reset handling, restored-session role gate.
- `apps/customer/src/components/AuthControls.tsx` — native eye/recovery/reset components.
- `apps/customer/src/MarketplaceScreen.tsx` — unified product/store search and store-result navigation.
- `apps/customer/src/lib/shopping.ts` — shared visible-name store matcher.
- `apps/customer/src/lib/api.ts` — configure existing generated client base URL.
- `apps/customer/src/lib/auth-search.test.ts` — Customer auth/search contracts.
- `apps/customer/package.json`, `pnpm-lock.yaml` — link the existing workspace API client; no new external authentication package.

### Dashboard

- `apps/dashboard/src/AuthControls.tsx`, `apps/dashboard/src/auth-controls.css` — shared web auth controls using existing tokens.
- `apps/dashboard/src/App.tsx` — Vendor/Admin auth controls, recovery/reset handling, Vendor legacy-route normalization.
- `apps/dashboard/src/DeliveryPartnerLogin.tsx` — shared eye and username recovery controls.
- `apps/dashboard/src/VendorStorePanel.tsx` — Delivery tab removal and existing Orders navigation.
- `apps/dashboard/src/DeliveryPartnerPortal.tsx`, `apps/dashboard/src/partner.css` — live-data dashboard UI improvements.
- `apps/dashboard/src/auth-portal-ui.test.ts` — shared control/navigation/dashboard contracts.

### API specification/generated contracts

- `lib/api-spec/openapi.yaml` — `loginCustomerUsername`, `requestAccountRecovery`, strict recovery input and generic outcome schemas.
- `lib/api-client-react/src/generated/api.ts`, `api.schemas.ts`.
- `lib/api-zod/src/generated/api.ts`, `generated/types/index.ts`.
- `lib/api-zod/src/generated/types/accountRecoveryInput.ts`, `accountRecoveryInputRole.ts`, `accountRecoveryOutcome.ts`.

Generated files were regenerated from OpenAPI, not manually patched.

### Documentation/decision notes

- This report and `docs/AUTH_AND_PORTAL_UI_PRESERVATION.json`.
- `.agents/memory/auth-username-assignment.md` and its index entry record the approved migration choice/provisioning constraint.

### API inventory

| API | Change |
|---|---|
| `POST /api/customer/login` | New username adapter to existing Supabase accounts |
| `POST /api/auth/recovery` | New generic role-aware adapter to Supabase recovery |
| `GET /api/auth/me` | Existing API reused; implementation unchanged |
| Vendor/Partner login APIs | Unchanged |
| Admin Supabase email login | Unchanged |
| Customer store/product/category reads | Unchanged; reused |
| Cart/order/delivery/assignment/inventory APIs | Unchanged |

## 8. Verification and preserved business logic

### Focused tests

**128 distinct focused checks passed** across API, dashboard, and Customer tests. These include:

- Customer username normalization, original identity/password use, wrong-role/unknown/wrong-password denial.
- Generic recovery outcomes across all four roles; provider failures, placeholder contacts, strict input, redirects, origin/throttling/timing contracts.
- Isolated PostgreSQL backfill, original row preservation, collision suffixes, explicit signup, atomic failure, immutable mappings, and helper permissions.
- Shared eye visibility state/labels and button wiring; role-specific recovery inputs; reset validation/session clearing.
- Global product/store query, category preservation, public-field matching, store navigation and address freshness.
- Existing Partner authorization/workflow contracts, Vendor email/username compatibility, Admin provisioning, Vendor order/receipt/action contracts, and Customer scrolling/shopping behavior.

Executed suites:

- API focused suite: **65 passed**, followed by the added route-security case and final targeted auth checks (**66 distinct API cases**).
- Dashboard suites: **35 passed**, with final verification of the six changed auth/UI cases.
- Customer suites: **27 passed**, with final verification of the four changed auth/search cases.
- Final cross-app targeted pass: **19 passed / 0 failed**.

No browser interaction tests were run. Source/contract assertions and pure visibility-state tests do not substitute for clicking every control; those actions remain in the manual checklist.

### Build/type/runtime checks

| Check | Outcome |
|---|---|
| OpenAPI regeneration and shared library TypeScript build | **Pass** |
| API TypeScript | **Pass** |
| Customer TypeScript | **Pass** |
| Dashboard Vite build | **Pass** |
| Customer Expo web export | **Pass** |
| Dashboard full TypeScript | **Blocked by the same 97 existing errors; no new changed-file errors** |
| Customer mobile-sized / Vendor desktop sign-in snapshots | **Rendered successfully** |
| Customer invalid login HTTP check | **401, generic message, no-store** |
| Unknown Customer recovery HTTP check | **202, generic message, no-store** |
| Disallowed-origin recovery HTTP check | **403** |
| Managed API/Customer/Dashboard workflows | **Running** |

The Customer snapshot reported a nonfatal resource 404 and the existing React Native web password-without-HTML-form notice; the sign-in UI rendered. The Vendor snapshot had no runtime exception.

### Data preservation

`AUTH_AND_PORTAL_UI_PRESERVATION.json` contains counts/checksums, not customer identities or credential values.

Twenty of 21 monitored public tables had unchanged row fingerprints, including every cart/order/stock/variant/store/assignment/profile table. Supabase Auth rows and pre-existing username bindings were unchanged.

One Master Catalog row appeared during the comparison window (`master_products` count 274 → 275); therefore the evidence deliberately does **not** claim that table's checksum was unchanged. This task's migration does not reference or write Master Catalog tables, and no catalog-write backend was modified.

Preserved: checkout/inventory locking, historical order/receipt snapshots, cart writes, pincode/category visibility, Partner assignment ownership and transitions, Vendor/Admin identities, active/inactive enforcement, and existing delivery actions.

## 9. Manual acceptance checklist — not yet executed

Use dedicated approved test accounts; do not reset real-user passwords without permission.

1. [ ] Existing Customer signs in using its assigned username and original password; invalid username/password is safely rejected.
2. [ ] Customer Forgot Password accepts username only and shows the generic message without exposing a contact or account existence.
3. [ ] New Customer registers a unique username/recovery contact, confirms through Supabase if required, and signs in with username; taken/invalid names fail safely.
4. [ ] Eye controls in Customer, Vendor, Partner and Admin login/reset forms toggle without submitting, losing text, or exposing passwords in logs.
5. [ ] Vendor retains both existing email and username sign-in; Forgot Password works with the existing deliverable registered contact.
6. [ ] Delivery Partner retains username sign-in; recovery reaches an approved real registered contact after placeholder-contact remediation where required.
7. [ ] Admin retains email sign-in and email recovery; Vendor/Partner/Customer credentials cannot enter the Admin portal.
8. [ ] For every role, a real reset link reaches the correct allowlisted portal, changes only that account's password, clears the recovery URL/state, signs out, and permits sign-in with the new password; expired/reused links fail safely.
9. [ ] One Customer search finds products and matching eligible stores, opens store results, handles empty results, and preserves category browsing/address changes without private fields.
10. [ ] Vendor has no Delivery tab/page; direct legacy paths return safely; READY summaries open Orders and existing preparation/assignment actions still work.
11. [ ] Delivery Partner desktop/tablet/phone dashboard shows real counts/activity and readable loading/empty/error states; accept/reject/pickup/start/deliver and automatic refresh remain functional.
12. [ ] Customer checkout/cart/order history, Vendor orders/stock/receipts, Admin management, and cross-store/role denial behavior remain unchanged.

