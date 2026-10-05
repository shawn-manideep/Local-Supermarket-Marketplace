# Admin Vendor Creation and Store Location — Implementation Report

Date: 2026-10-05  
Scope: existing marketplace application, development environment only. Implementation complete; no deployment and no automated browser tests.

## 1. Current Vendor/Store profile

The existing Supabase Auth user remains the vendor identity. Its existing application role is `vendor`; its store remains identified by the original `stores.id` and `owner_user_id`. The existing shared username registry is reused. No duplicate vendor table, store table, credentials table, username registry, or authentication system was introduced.

Existing store fields remain: shop name, description, logo URL, phone, status, delivery fee, minimum order value, commission rate, and timestamps. The existing daily operating-hours model and endpoints remain in use.

Eight nullable store-owned fields were added:

| Field | Purpose |
|---|---|
| `ownerName` | Store owner/contact name |
| `email` | Store contact email |
| `addressLine1` | Physical address |
| `addressLine2` | Optional additional physical address |
| `locality` | Area/locality |
| `city` | City |
| `state` | State |
| `pincode` | Physical Indian six-digit postcode |

Legacy stores retain null values until explicitly edited. No addresses were fabricated or backfilled. The physical store pincode does **not** replace or change existing delivery-service pincodes.

## 2. Admin creation workflow

Admin Portal → Vendors → **Add vendor** opens the existing directory's creation form.

- Account section: username, password, confirm password.
- Shared store section: shop name, owner, mobile/contact email, description, logo URL, physical address, delivery fee, and minimum order value.
- Existing weekly opening-hours model: seven daily controls, with closed days represented by null opening/closing times.
- New vendors always start `PENDING_APPROVAL`, following the original approval lifecycle. Status is not an unrestricted creation/profile input.
- Passwords use temporary input refs, are compared before submitting, and are cleared on completion, cancellation, validation failure, failed requests, and unmount. They are not written to a frontend store, browser persistence, database column, audit event, report, or returned vendor profile.
- The server checks Admin role before validation/provisioning. Other roles and unauthenticated users cannot create or administratively edit vendors.
- Username reservation shares the partner provisioning advisory-lock namespace and global unique registry.
- Supabase initially creates a disabled identity; the application transaction sets the vendor role, removes the trigger-created customer record, reserves the username, creates the store/hours, and records the creation audit.
- Only after verifying the committed profile is the Auth identity enabled.
- Failure compensates only the newly created identity/profile/store/username/audit. An unresolved compensation failure is reported explicitly rather than silently returning success.
- Creating a vendor creates **zero product listings**.

The directory refreshes after successful creation. It displays shop, owner, location, username, creation date, and existing status. Its server-backed search includes owner and location.

## 3. Editing and status lifecycle

Admin detail groups account, owner, store, location, operations, hours, and existing status actions. Admin can edit the store profile and operating hours. Existing store and vendor IDs are retained.

Vendor Portal → existing Store Profile includes the same owner/contact/address fields and the existing settings. Its API always derives the store from the authenticated vendor, never a submitted store ID.

Username, password, ownership, role, and status are rejected in profile updates. Contact email editing changes only the store contact field, **not** the Supabase authentication email. Existing email-login vendors remain compatible.

Existing transitions are unchanged:

- `PENDING_APPROVAL` → `ACTIVE` or `REJECTED`.
- `ACTIVE` → `SUSPENDED`.
- `SUSPENDED` → `ACTIVE`.

Status changes continue through the existing dedicated administrative status endpoint, including its auditing and restrictions. Suspended vendors are denied through both existing protected-access rules and the new username-login entry point. Pending vendors can complete their profile; customer discovery still requires an active eligible store.

## 4. Authentication and validation

Username login is an adapter over the existing Supabase password session, not a new authentication system. It resolves the shared registered username to the existing Auth identity, performs existing Supabase password authentication, and feeds the resulting access/refresh tokens into the existing frontend `setSession`. Original email/password sign-in remains available. Admin sign-in remains email-only; partner sign-in is unchanged.

- Existing case-normalized ASCII username rules: 3–30 characters, leading letter, letters/digits/underscore thereafter, reserved names rejected. Invalid whitespace/punctuation is not silently sanitized.
- Password rules reuse the existing provisioning policy: 8–128 characters.
- Creation requires username, password, shop name, owner name, address line 1, locality, city, state, and pincode.
- Mobile, contact email, address line 2, description, logo URL, and hours are optional. Supplied mobile/email values reuse existing contact validation.
- Pincode: six digits, first digit nonzero; enforced in shared request validation and the additive database constraint.
- Shop name maximum 120; owner maximum 100; address lines maximum 250; locality/city/state maximum 120; email maximum 254; description maximum 2000; logo uses the existing URL convention.
- Fees/minimum-order values remain nonnegative cent-compatible settings, capped by existing shared validation.
- Opening-hours validation reuses the existing open/closed-day rules, disallows duplicate days, and requires closing after opening.
- Profile/create schemas reject unknown identity, role, status, commercial, stock, SKU, and variant inputs.
- Username-login rate limiting is 10 attempts/minute per existing rate-limit identity, separate from partner login and ordinary mutations.

## 5. APIs and customer-visible location

| Endpoint | Change |
|---|---|
| `POST /api/admin/vendors` | New Admin-only vendor/store provisioning; returns the created management detail, HTTP 201 |
| `PATCH /api/admin/vendors/:id` | New Admin-only store-profile/hour update |
| `GET /api/admin/vendors` | Existing paginated directory extended with owner/location and location-aware search |
| `GET /api/admin/vendors/:id` | Existing detail extended with full store profile and existing hours |
| `POST /api/vendor/login` | New username entry point returning the existing Supabase session |
| `GET /api/vendor/store` | Existing response includes the new store fields |
| `PATCH /api/vendor/store` | Existing own-store update validates/persists the new fields |
| Existing customer store projections | Add locality, city, state, and physical pincode only |

Customer store cards/catalog headers and product-store context display available locality/city/state/pincode. Legacy null locations are omitted. Customer projections do not expose owner identity, owner name, store contact email, usernames, or exact inventory through this change. Existing eligibility, delivery-area checks, search, cart, checkout, and order creation are unchanged.

OpenAPI and generated React/Zod clients/types were regenerated for the administrative provisioning/update, vendor login/profile, and extended management responses.

## 6. Database migration and preservation evidence

Created and applied **only to the confirmed development project**:

`database/migrations/0017_vendor_store_profile_location.sql`

It adds the eight nullable store columns and `stores_physical_pincode_check`. No existing data is rewritten; existing API-only writes, privileges, and RLS remain unchanged. The corresponding Drizzle store schema includes the new fields and constraint.

The established Supabase migration history records the new migration. Earlier approved migrations were not edited. The unrelated, previously pending Excel migration was **not** applied to the managed development database.

A real development Auth smoke test created a newly generated temporary vendor, verified both username and existing email/password sign-in, verified the existing role/store resolution and pending profile, then removed only that temporary account/store/audit. No existing account credentials were used, reset, or reported.

Before/after database verification:

| Data | Before | After |
|---|---:|---:|
| Stores | 2 | 2 |
| Product listings | 41 | 41 |
| Product variants | 89 | 89 |
| Orders | 26 | 26 |
| Order-status history | 84 | 84 |
| Delivery assignments | 4 | 4 |

Full-row fingerprints, sorted by original IDs, matched exactly:

- Products and variants: `c0f3d8bf06fd78d3b4cc90a4591f2037`.
- Orders, items, status history, assignments: `e1e82cadab8d25c7809131c0d0c611bf`.
- Original store columns, excluding only the eight newly added columns: `505993b8fbd848fefd057d94c0ed204e`.

Both existing stores retain null new location/contact fields. Prices, stock, availability, variant definitions, SKU/external codes, original store settings, historical snapshots, and delivery duties were not changed.

## 7. Tests and checks

Final passing runs:

| Test group | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Vendor validation + new isolated PostgreSQL/HTTP integration + existing Admin management/store validation | 58 | 0 | 0 |
| Existing partner/auth, delivery contracts, shopping, cart, order/reorder/inventory contracts | 107 | 0 | 0 |
| Explicit development-only real Supabase Auth smoke tests | 2 | 0 | 0 |
| Non-browser React server-render/source and weekly-hours serialization checks | 6 | 0 | 0 |
| **Total** | **173** | **0** | **0** |

The focused isolated integration suite includes 17 tests. It uses a disposable PostgreSQL 17 cluster with the project's migrations and real HTTP/SQL/RLS/transactions. Only the external Auth provider is simulated there; the separate two-test opt-in run exercised actual development Supabase Auth.

Coverage includes: Admin-only permissions and zero writes on denial; required/invalid fields; case-insensitive and globally shared username conflicts; duplicate Auth email; concurrent duplicate creation; A/B profile isolation; no copied/automatic listings; preserved Auth/store identity; commercial/history/assignment invariance; database/activation compensation; transactional rollback when hours fail; immutable profile fields; original suspension rules; physical-vs-service pincode distinction; direct authenticated write denial; and existing session resolution.

Additional checks:

- Shared validation/database builds: passed.
- Backend build and typecheck: passed.
- OpenAPI generation and shared-library TypeScript build: passed.
- Dashboard production build: passed.
- Customer TypeScript check: passed.
- Customer web Expo export: passed during managed workflow restart.
- `git diff --check`: passed.
- API, dashboard, and customer managed workflows restarted once after the completed batch; all running.
- Proxied dashboard/customer URLs returned HTTP 200; API health returned `{"status":"ok"}`.
- Static desktop dashboard and phone-sized customer screenshots show working sign-in pages. They do **not** establish interactive acceptance of signed-in pages.
- No automated browser tests were run, as requested.

Known existing limitation: full dashboard TypeScript checking still reports **97 pre-existing errors** in older test-file Buffer/string typings and Vite proxy typings. There are no reported errors in the changed production source or new profile test. These unrelated errors were not repaired in this scope. The static dashboard capture also reports a non-blocking resource 404; customer capture reports its existing password/form DOM notice.

Representative reproduction commands:

```sh
pnpm --filter @workspace/api exec tsx --test \
  src/admin-management/vendor-validation.test.ts \
  src/admin-management/vendor-profile.integration.test.ts \
  src/admin-management/management.integration.test.ts \
  src/store-management/validation.test.ts src/security.test.ts

pnpm --filter @workspace/api exec tsx --test \
  src/delivery-partner/foundation.test.ts src/delivery-partner/partner.integration.test.ts \
  src/delivery-partner/workflow.contract.test.ts src/orders/reorder.test.ts \
  src/orders/vendor-management.test.ts src/orders/orders.test.ts \
  src/orders/inventory-contracts.test.ts src/customer-marketplace/marketplace.test.ts \
  src/customer-cart/cart.test.ts

pnpm --filter @workspace/api exec tsx --tsconfig ../../apps/dashboard/tsconfig.json \
  --test ../../apps/dashboard/src/vendor-profile.test.tsx

# Opt-in: fixed confirmed development project only; temporary identity is cleaned.
RUN_VENDOR_PROFILE_LIVE_AUTH=1 pnpm --filter @workspace/api exec tsx \
  --test src/admin-management/vendor-live-auth.integration.test.ts
```

Use the dashboard's TypeScript configuration for its server-render tests; the backend's default JSX configuration does not match the Vite frontend.

## 8. Files changed

Backend:

- `backend/api/src/admin-management/{routes,service,vendor-profile}.ts`
- `backend/api/src/admin-management/{vendor-validation.test,vendor-profile.integration.test,vendor-live-auth.integration.test}.ts`
- `backend/api/src/auth/routes.ts`
- `backend/api/src/delivery-partner/auth-service.ts`
- `backend/api/src/store-management/routes.ts`
- `backend/api/src/customer-marketplace/routes.ts`
- `backend/api/src/security.ts`

Shared/database/contracts:

- `database/migrations/0017_vendor_store_profile_location.sql`
- `lib/db/src/schema/index.ts`
- `packages/validation/package.json`, `packages/validation/src/{index,vendor-profile}.ts`
- `lib/api-spec/openapi.yaml`
- Regenerated `lib/api-client-react/src/generated/{api.ts,api.schemas.ts}`.
- Regenerated `lib/api-zod/src/generated/api.ts`, its type index, extended management types, and new store-profile/hour/vendor-profile/provisioning types.

Dashboard:

- `apps/dashboard/src/{App,VendorStorePanel,StoreProfileFields,WeeklyHoursFields}.tsx`
- `apps/dashboard/src/{api,admin-api}.ts`
- `apps/dashboard/src/admin/AdminPortal.tsx`
- `apps/dashboard/src/admin/admin.css`, `apps/dashboard/src/index.css`
- `apps/dashboard/src/vendor-profile.test.tsx`

Customer:

- `apps/customer/src/MarketplaceScreen.tsx`
- `apps/customer/src/components/ShoppingProductDetails.tsx`
- `apps/customer/src/lib/api.ts`

Documentation:

- This implementation report.
- Existing agent memory updated with the durable store/contact/identity boundaries; no credentials or activity log recorded there.

## 9. Final scope confirmation

Vendor commercial data and historical orders are unchanged, verified by complete persisted-row fingerprints and isolated regression tests. Existing customer, vendor, partner, delivery, stock, catalog, order, and authentication boundaries were preserved. No GPS/maps, delivery-area replacement, payment, notification, inventory-import, role-conversion, or second credential system was introduced.

Implementation and report are complete. **No deployment, no automated browser tests, and no subsequent feature work.**
