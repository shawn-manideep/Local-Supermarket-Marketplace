# Phase 6 — Delivery Partner implementation report

## A. Username foundation

- `identity_usernames` is a shared identity registry across every application role, not a partner-specific namespace. One immutable normalized username per application identity; a database unique constraint prevents duplicate claims across roles.
- Shared validation enforces ASCII, 3–30 characters, a leading letter, then letters/digits/underscore. Valid case variants normalize to lowercase. Invalid input is never trimmed or sanitized. The explicit numeric rule takes precedence over the contradictory `shar` invalid example.
- Twelve explicitly reserved names are rejected. Existing customer/vendor/admin identities have not been assigned invented usernames.
- Login privately resolves username → application identity → Supabase Auth email, then uses Supabase password authentication. A new non-persisting client handles each password session. The client receives only the normal access/refresh tokens.
- No custom password hashing, password storage, public username lookup, or technical Auth email in application response DTOs. Login errors are generic unless an inactive account's credentials have first been verified. Partner login has a separate 10-attempt/IP/minute rate-limit bucket.

## B. Delivery Partner

- The existing lowercase role enum is extended with `delivery_partner`; the administrative UI identifies these accounts as `DELIVERY_PARTNER`.
- Admin provisioning creates the Auth identity, application role, global username and partner profile. Profile contains display name, optional Indian contact number, ACTIVE/INACTIVE and timestamps.
- A new Auth identity begins banned until the database transaction commits. Per-username advisory locking and the database unique constraint handle competing claims; failures use compensating Auth/application cleanup, including the customer shell created by the existing Auth trigger. Database-level competing claims return a clean `USERNAME_TAKEN` conflict.
- Admin can list/create accounts and change ACTIVE/INACTIVE status. There is no public partner signup, role editing, username change, account deletion, or partner profile editing.
- `/delivery-partner` within the existing dashboard artifact provides username/password login, Dashboard, My Deliveries, Profile and existing Supabase logout. Dashboard counts are actual own-assignment counts for today's Asia/Kolkata creation date. The portal clears data on account/token changes, logout and denied access, and checks freshness every 45 seconds.
- Operational APIs authenticate through the unchanged existing verifier, require the authoritative partner role and recheck ACTIVE status. Existing inactive tokens are denied; the shared `/api/auth/me` additionally denies inactive partners without changing other roles' behavior.
- `delivery_assignments` is a minimal relationship foundation only: order, partner, status and timestamps. No assignment creation endpoint, duty action, pickup, order transition, notification, tracking or map has been added.

### Endpoints

| Method | Path | Access |
|---|---|---|
| POST | `/api/delivery-partner/login` | Password authentication; active partner only |
| GET | `/api/delivery-partner/me` | Active partner's own safe profile |
| GET | `/api/delivery-partner/dashboard` | Active partner's own daily counts |
| GET | `/api/delivery-partner/deliveries` | Active partner's own assignment metadata |
| GET / POST | `/api/admin/delivery-partners` | Existing admin role |
| PATCH | `/api/admin/delivery-partners/:partnerId/status` | Existing admin role |

### Database and RLS

Applied to the confirmed **development database only**, in separate committed migrations:

1. `0012_delivery_partner_role.sql` — enum addition.
2. `0013_delivery_partner_foundation.sql` — registry, immutable identity trigger, profiles, assignment foundation, RLS and grants.

Authenticated direct access is read-only. Partners can read their own active profile and assignment metadata, never other partners' records. Assignment order/partner identifiers are not granted to direct readers. Admin has appropriate directory/profile reads, but no automatic partner operational or assignment access. Anonymous access and client mutations on all new tables are denied.

## C. Regression and preservation

- Real development Supabase checks verified the unchanged customer/vendor/admin email/password mechanism using temporary role identities; partner token/session establishment and logout also passed.
- Existing API regressions for shopping, cart, reorder, catalog, variants/stock, vendor orders, lifecycle and historical snapshots passed. Existing customer and dashboard suites passed.
- Before/after database checksums matched for orders, items, status history, product variants including stock, Master Catalog and existing application profiles.
- No stock, checkout, cart, order inventory, variant, Master Catalog, reorder, vendor ownership or customer UI implementation was changed.
- Development verification accounts were deleted. The new registry, partner-profile and assignment tables are empty; no sample assignments or test Auth identities remain.

## D. Automated tests

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Full API suite, including 20 focused Phase 6 tests | 175 | 0 | 2 |
| Explicit real Supabase/HTTP Phase 6 integration | 12 | 0 | 0 |
| Dashboard, including 3 new source-contract tests | 19 | 0 | 0 |
| Customer shopping/reorder | 27 | 0 | 0 |

The ordinary API invocation skips the explicitly opted-in Phase 6 integration, which was executed separately successfully, and the pre-existing opted-in Master Catalog HTTP acceptance. No required new Phase 6 tests remain unexecuted. Dashboard source-contract tests are not interactive browser tests.

## E. Typecheck, build and runtime

- Full workspace typecheck: passed; final changed dashboard/API code additionally checked through their typecheck/build.
- API build: passed.
- Dashboard build with existing public Supabase configuration: passed.
- Customer Expo web export: passed.
- Managed dashboard/API workflows are running. Development health returns 200; anonymous partner API access returns 401.
- A static anonymous mobile login preview was inspected. **No automated browser journeys or signed-in browser verification were performed.** Manual acceptance remains outstanding.
- No publishing or production migration was performed.

## Files changed

- `apps/dashboard/src/`: `App.tsx`, new `DeliveryPartnerLogin.tsx`, `DeliveryPartnerPortal.tsx`, `AdminDeliveryPartners.tsx`, scoped `partner.css`, and `delivery-partner.test.tsx`.
- `backend/api/src/delivery-partner/`: new repository, Supabase Auth/provisioning service, middleware, routes, foundation tests, isolated PostgreSQL integration tests and explicitly opted-in development Auth/HTTP tests.
- `backend/api/src/`: additive route mounting in `app.ts`, partner-only inactive check in `auth/routes.ts`, independent login limiter in `security.ts`; API test command includes the new suite.
- `packages/shared-types/src/index.ts`, `packages/validation/src/index.ts`, `lib/db/src/schema/index.ts`.
- Both new migrations and the migration journal.
- `lib/api-spec/openapi.yaml` and regenerated React client/Zod contracts, including generated partner types.
- This report and project-memory boundary notes. Existing customer application, dashboard global stylesheet and historical migrations were not edited.

## Known limitations

- Auth and PostgreSQL cannot share one distributed transaction. Normal failure/compensation paths are tested; a simultaneous Auth/database cleanup outage returns 503 and requires administrator attention rather than pretending provisioning succeeded. No automatic recovery queue was introduced.
- The dashboard emits a non-blocking bundle-size warning.
- Assignment views intentionally return empty results until a separately approved assignment implementation exists. Assignment reads are capped at 100 metadata rows; no Phase 7 workflow exists.
- Signed-in desktop/mobile interaction and browser-back acceptance require the manual checklist below.

## F. Manual browser checklist

Run the partner checks on desktop and phone-sized layouts:

1. Sign in as an existing admin; open **Delivery Partners** and create an ACTIVE account with a valid username/password, display name and optional contact.
2. Confirm it appears in the directory under `DELIVERY_PARTNER`; confirm a case-variant duplicate is rejected and invalid/reserved usernames are rejected.
3. Sign out; open `/delivery-partner` and sign in using username/password, including a case variant of the username.
4. Confirm the account reaches the dedicated Partner Portal, not vendor/admin controls.
5. Check today's dashboard counts are zero and no sample deliveries appear.
6. Open **My Deliveries** and confirm **No deliveries assigned yet** with no duty/pickup/delivery action buttons.
7. Open **Profile** and confirm display name, normalized username, contact and account status; fields are read-only.
8. Sign out; use browser Back/refresh and confirm protected partner information is not restored. Switch accounts and confirm old partner data never appears.
9. In a separate admin session mark that partner INACTIVE. Confirm the existing partner session is denied on its next request/refresh, and new login shows an inactive-account message. Reactivate and confirm login works again.
10. Verify a customer session cannot enter partner operational APIs/portal.
11. Verify a vendor session cannot enter partner operational APIs/portal.
12. Verify a partner cannot enter the vendor dashboard or use vendor/admin/customer protected controls.
13. Verify the partner cannot read arbitrary marketplace orders, customer details, another partner's profile or deliveries.
14. Verify existing customer/vendor/admin email sign-in and shopping, catalog, cart, reorder and order-management workflows still work.
15. Recheck the previously accepted stock deduction/restoration behavior without changing its implementation.

**Phase 6 only. Phase 7 was not started.**