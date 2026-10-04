# Phase 7 — Delivery assignment and workflow

## Files changed

- API: new `backend/api/src/delivery-partner/workflow.ts`, workflow database and contract tests; extended `routes.ts`; extended live Auth/HTTP regression test.
- Existing orders: `backend/api/src/orders/routes.ts` adds the explicit vendor dispatch/completion denial only. Stock helpers, checkout and restoration logic are unchanged.
- Dashboard: `OrderOperations.tsx`, `DeliveryPartnerPortal.tsx`, `api.ts`, `vendor-orders.ts`, scoped partner/vendor CSS, vendor/partner tests.
- Customer: `apps/customer/src/OrdersScreen.tsx` adds abortable order-detail status/history refresh only. No Home, address, authentication or receipt redesign.
- Shared database: `lib/db/src/schema/index.ts`.
- Contract: `lib/api-spec/openapi.yaml` and regenerated React client/Zod schemas/types.
- Migration: `database/migrations/0014_delivery_workflow.sql` and journal. Previous migrations are untouched.

## Model and state machine

Extended the existing Phase 6 `delivery_assignments` table rather than creating another table. Added assigned/accepted/rejected/picked-up/delivered timestamps, valid-state and timestamp checks, immutable assignment ownership, role validation and a partial unique index for one active assignment per order.

Duty: PENDING → ACCEPTED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED.
PENDING can instead become REJECTED, or CANCELLED when explicitly replaced.

Order remains the authoritative business object:

- Assignment, acceptance, rejection and pickup leave the order READY.
- Start Delivery transactionally changes the assignment and existing order to OUT_FOR_DELIVERY.
- Mark Delivered transactionally changes both to DELIVERED.
- Both order transitions append existing `order_status_history` with partner actor and actual event time.
- Assignment rejection never rejects/cancels the customer order.

The additive migration was applied to the confirmed development Supabase project only. It refuses non-empty legacy assignment data rather than inventing timestamps or rewriting history. The foundation was confirmed empty before application.

## Vendor and partner flows

Vendor details in both preparation/delivery views show the assigned display name and progress. Own-store READY orders can select ACTIVE partners. Pending replacement requires confirmation and preserves the cancelled prior record. Rejected duties can be explicitly reassigned. Accepted/picked-up/out-for-delivery duties cannot be silently replaced.

Partner dashboard shows own daily Pending, Accepted, Picked Up, Out for Delivery and Delivered counts. My Deliveries provides own references/store/status/time/total and minimum recipient/address snapshot. Details have state-appropriate duty actions, rejection confirmation and in-flight duplicate protection. No customer account, contact phone, username or commission details are returned in delivery DTOs. Rejected/cancelled duties no longer expose recipient/address.

Partner/vendor screens use scope-safe refresh/polling. Customer details refresh the existing order endpoint and existing status/history display, without a second tracking model or private partner details.

## Authorization, concurrency and stock

- Vendor ownership is checked through the authenticated identity, store ownership and order store.
- Every duty write resolves authenticated partner → active role/profile → assignment ownership.
- Transactions lock the order first, then partner profile and assignment; status is rechecked after waiting.
- Simultaneous assignment attempts leave one active row. Repeated duty actions fail safely; duplicate history is prevented.
- Direct authenticated assignment mutations remain revoked; RLS restricts partner metadata to self and vendor metadata to own-store orders. No broad order/customer access was granted to partners.
- Legacy vendor OUT_FOR_DELIVERY/DELIVER actions are denied server-side and removed from vendor action controls.
- No delivery action imports or invokes inventory operations.
- Before/after development checksums match existing orders, items/history, variants/stock, Master Catalog, profiles, customers and stores. No sample development assignments remain; workflow fixtures ran in disposable PostgreSQL only.

## API endpoints

| Method | Route |
|---|---|
| GET | `/api/vendor/delivery-partners` |
| GET / POST | `/api/vendor/orders/:orderId/delivery` |
| GET | `/api/delivery-partner/deliveries` |
| GET | `/api/delivery-partner/deliveries/:assignmentId` |
| POST | `/api/delivery-partner/deliveries/:assignmentId/actions` |
| GET | `/api/delivery-partner/dashboard` |

Assignment POST body: `{ partnerId }`. Duty POST body: `{ action }`, where action is ACCEPT, REJECT, PICKUP, START or DELIVER. Unknown fields are rejected. Customer continues using existing own-order endpoints.

Structured errors include ORDER_NOT_READY, PARTNER_NOT_FOUND, PARTNER_INACTIVE, INVALID_ASSIGNMENT, ASSIGNMENT_NOT_PENDING, ASSIGNMENT_ALREADY_HANDLED, NOT_ASSIGNED_PARTNER, INVALID_DELIVERY_TRANSITION, DELIVERY_ALREADY_COMPLETED and UNAUTHORIZED_DELIVERY_ACTION. Raw database diagnostics are not returned.

## Verification

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Full API suite | 194 | 0 | 2 |
| Explicit real development Supabase/Auth HTTP regression | 13 | 0 | 0 |
| Dashboard tests | 20 | 0 | 0 |
| Customer shopping/reorder tests | 27 | 0 | 0 |

The default API suite skips the explicitly opted-in Auth regression, which passed separately, and the pre-existing opted-in Master Catalog HTTP acceptance. Phase 7 includes 15 isolated database/HTTP tests plus 2 contract tests, covering the requested assignment/action/isolation/concurrency/privacy/stock/history cases, including forced history-write rollback.

Full workspace typecheck, API build, dashboard build and customer Expo web export passed. Existing stock placement/restoration, cart, variants, catalog, order, reorder and authentication regressions passed. Managed preview workflows restarted successfully.

**No automated browser testing was performed. Signed-in browser acceptance remains manual.**

## Known limitations

- The existing dashboard emits a non-blocking bundle-size warning.
- In-app visibility refreshes at polling intervals, not instantly. Partner metrics retain the existing Asia/Kolkata daily scope; delivery lists currently return the latest 100 rows.
- One pre-Phase-7 development order is already OUT_FOR_DELIVERY without an assignment. It was left unchanged. READY-only assignment and partner-only completion mean it needs separately approved legacy remediation; no automatic backfill or vendor bypass was introduced.
- The Phase 6 test-account cleanup command intentionally refuses accounts with assignments, protecting order-linked delivery records.
- No GPS, maps, tracking, external notifications, payments, payouts, Admin Portal or Phase 8 features were added.

## Manual browser acceptance

Use the existing ACTIVE `deliverytest1` account and its saved password. Verify on desktop and phone-sized layouts:

1. Customer places a new order.
2. Vendor accepts it.
3. Vendor moves it to Preparing.
4. Vendor marks it Ready.
5. Vendor sees ACTIVE delivery partners.
6. Vendor assigns a partner.
7. Assigned partner sees the new duty after refresh/poll.
8. Partner accepts duty.
9. Vendor sees Accepted.
10. Partner marks Picked Up; order stays READY.
11. Partner starts delivery.
12. Vendor sees Out for Delivery.
13. Customer sees Out for Delivery.
14. Partner marks Delivered.
15. Vendor sees Delivered.
16. Customer sees Delivered and matching timeline.
17. Another partner cannot read or act on the duty/order.
18. Vendor cannot perform partner-only actions.
19. Customer cannot assign or perform delivery actions.
20. Stock remains unchanged throughout duty/delivery actions.
21. Double-click, refresh and repeated completion do not duplicate effects.
22. On another READY order, partner rejection leaves the order READY.
23. Vendor explicitly assigns another ACTIVE partner after rejection.

Additionally confirm pending replacement warns/cancels the old duty, accepted duties cannot be replaced, inactive partners are excluded/denied, and cross-store vendor assignment fails.

**Development only. No production data or production migration was touched. No deployment. Phase 8 not started.**