# Store orderability, delivery scheduling and Vendor document verification

## Scope and completion

Implemented the four requested changes in the existing Customer, Vendor, Admin
and Delivery Partner portals. No production publishing, automated browser tests,
unrelated redesigns, authentication changes or unrelated error fixes were performed.
The previous address-origin diagnostic is outside this change.

## 1. Closed-store orderability

- Customer browsing remains available for administratively active but currently
  closed stores. “Currently Closed” is separate from product availability and
  stock labels; closure does not set stock to zero.
- Product/variant Add actions and cart checkout are disabled for a closed store.
  Existing cart contents remain visible.
- Direct cart additions, quantity increases and repeat-order additions validate
  current operating hours. Decreasing/removing existing cart items remains allowed.
- Checkout validates administrative ACTIVE status and the saved weekly operating
  hours inside its existing transaction, immediately before inventory deduction.
  Both Instant and Scheduled requests reject current closure with
  `409 / STORE_CLOSED`; invalid administrative eligibility also remains rejected.
- Rejected checkout does not deduct stock, create an order, convert the cart or
  create delivery records. The cart is retained.
- Operating-hour writes lock the parent store, serializing normal hour changes
  against checkout's store lock. The last orderability check uses the database
  clock rather than a client-supplied time.
- Daily OPEN/CLOSED remains derived from operating hours, not a replacement for
  the store's administrative status.

## 2. Vendor own-product search

The Vendor catalog now filters its already store-scoped product list by a
trimmed, case-insensitive partial name **or brand** search. Search combines with
the existing category/uncategorized filter and preserves product order.

The own-product search is separate from Master Catalog search. It does not query
or merge another Vendor's private listings. Search/category controls use the
existing responsive theme and equal-width layout.

## 3. Instant and Scheduled delivery

### Policy selected by the user

- Instant is the default, retaining the existing fulfillment process.
- Scheduled offers **one-hour slots for today and tomorrow** in
  **Asia/Kolkata (India time)**.
- Slots start on the saved opening-time alignment. For example, an 08:30 opening
  yields 08:30–09:30, 09:30–10:30, and so on.
- A full hour must fit within a saved same-day operating window. Missing hours,
  closed days, past starts and periods extending beyond closing are excluded.
  Overnight opening windows are not introduced.
- The selected address pincode must be served by the store.
- The store must be open **when accepting the order**, even if delivery is
  scheduled for tomorrow. Scheduled mode is not a closed-store bypass.
- Slot options are revalidated on checkout against current hours and the
  database clock. Forged, expired or no-longer-valid windows return
  `DELIVERY_SLOT_UNAVAILABLE`.

### Order snapshot and lifecycle

The existing order record now stores:

| Field | Instant | Scheduled |
|---|---|---|
| `delivery_mode` | `INSTANT` | `SCHEDULED` |
| `scheduled_start_at` | null | selected canonical start |
| `scheduled_end_at` | null | selected canonical end |

These are delivery-choice snapshots, not a replacement for `delivery_type`.
Legacy orders default to Instant. Later changes to store hours do not rewrite
accepted windows. Stock deduction and cancellation/restoration retain their
existing transaction behavior; scheduled stock is deducted at order acceptance,
just like Instant stock.

Customer checkout provides date/time selection, loading/retry/refresh states,
and clears stale choices when its store/address/slot options change. Its
idempotency intent includes mode and selected window. Server replay checks also
compare these values, preventing a reused checkout from changing delivery mode.

Customer order list/detail, Vendor order operations and Delivery Partner
assignments show mode and scheduled windows in India time.

The existing assignment lifecycle remains unchanged. A Partner may accept an
assignment ahead of time, but pickup and dispatch return
`SCHEDULED_DELIVERY_NOT_DUE` before the scheduled start. Portal actions reflect
that restriction. Vendor direct pickup/dispatch remains prohibited by the
existing assigned-Partner authorization. No automatic dispatch scheduler,
automatic rescheduling or automatic cancellation was added.

## 4. Vendor document verification

### Onboarding lifecycle

1. New/onboarding Vendors remain catalog-gated.
2. Four current mandatory uploads—FSSAI, Aadhaar, PAN and Photo—establish upload
   completeness only; they do **not** unlock the catalog.
3. Explicit Submit changes the mandatory current versions to SUBMITTED and
   creates a submission receipt. Catalog access stays locked.
4. Submitted mandatory files cannot be replaced while that review is pending.
   Optional uploads remain informational.
5. Admin reviews existing private document previews, then approves the exact
   current submission or rejects selected mandatory types with a required reason.
6. Full mandatory approval unlocks document-gated catalog operations.
7. Rejection retains the reason and locks the catalog. Corrected uploads and
   resubmission create a fresh review receipt; stale Admin receipts cannot approve
   newer versions.
8. Replacing an approved mandatory version invalidates current verification and
   requires resubmission/approval.

Optional documents are not automatically approved when mandatory documents are
approved. Existing private content viewing, current-version identity checks,
replacement history, MIME validation and browser blob cleanup are retained.

### Authorization and catalog gate

- Submit is authenticated Vendor-only and resolves the caller's own store.
- Approve/reject are authenticated Admin-only and resolve the selected Vendor
  account, never a caller-supplied store association.
- Vendors cannot approve themselves or access another Vendor's private documents.
  Customer, Delivery Partner and anonymous review requests are denied.
- Existing central server-side catalog guards now require current mandatory
  approval for non-exempt stores. They cover product creation/update, categories,
  variants, stock/price and Master Catalog additions, including nested mutations.
- A protected-field trigger prevents authenticated clients from assigning
  verification/exemption metadata directly.
- Orders, Profile, Settings and logout remain outside the document onboarding
  gate. Approval does not change store administrative status.
- Admin Vendor directory/detail includes a small review-status indicator.
  Exempt existing access is not presented as an Admin approval.

## Development migration and compatibility

Added and applied the forward-only development migration:

`database/migrations/0021_orderability_delivery_verification.sql`

It adds the order snapshot fields/consistency checks, minimal review metadata on
existing stores/documents, the hours-write store-lock trigger and protected
verification-field enforcement. No duplicate order, delivery, catalog, document
or authentication tables were created. Previously approved migration files were
not edited.

Before review was introduced, **five** Vendors could already manage catalogs:
three legacy-exempt accounts and two upload-complete accounts. All five retained
access. The one already-incomplete onboarding account remains gated. Migration
does not fabricate approval records: **zero** stores were marked APPROVED.

Before/after development comparison found unchanged existing data fingerprints
for orders, products, variants/stock, Master Catalog products, document records
(excluding new metadata defaults), carts, cart items, order items and delivery
assignments. No live test orders, catalog products or document uploads were
created for this verification.

## API and shared-contract changes

| Endpoint / contract | Change |
|---|---|
| `GET /api/customer/stores/:storeId/delivery-slots?pincode=...` | Customer-only canonical options, current OPEN/CLOSED and India timezone |
| `POST /api/customer/orders` | Delivery mode/window input, transactional validation and snapshot |
| Customer cart Add/PATCH; repeat-order Add | Closed-store write restrictions; cart exposes operating status |
| Customer/Vendor order responses | Delivery snapshot fields |
| Delivery Partner assignment/actions | Snapshot fields and before-start pickup/dispatch denial |
| `GET /api/vendor/documents` | Current verification state, receipt, dates and reason |
| `POST /api/vendor/documents/submit` | Explicit mandatory submission |
| `PUT /api/vendor/documents/:type` | Pending mandatory freeze; replacement invalidation |
| `GET /api/admin/vendors/:vendorId/documents` | Review metadata alongside existing private viewing |
| `POST /api/admin/vendors/:vendorId/documents/approve` | Requires matching `submissionId` |
| `POST /api/admin/vendors/:vendorId/documents/reject` | Requires `submissionId`, reason and mandatory `rejectedTypes` |
| Admin account list/detail | Document verification indicator |

OpenAPI, generated clients/validators, checkout validation and shared order schema
were updated. Dashboard document types reuse the generated shared contracts.
Existing API-origin/cookie/Supabase authentication transport was not changed.

## Verification results

| Focused suite | Passed | Failed |
|---|---:|---:|
| Document/API integration, compatibility, closed cart/checkout, order snapshots and hour-lock serialization | 28 | 0 |
| Inventory, concurrent checkout, replay, rollback and restoration regression | 27 | 0 |
| Delivery Partner workflow, ownership, assignment and scheduled timing | 16 | 0 |
| Slot generation and checkout validation | 6 | 0 |
| Admin private document UI/security contracts | 4 | 0 |
| Own-product name/brand/category/order search | 4 | 0 |
| **Final verified total** | **85** | **0** |

Execution detail: the combined six-suite run passed the unaffected 57 tests and
initially failed two document-fixture assertions. After correcting that fixture's
cart-clear response expectation (204 rather than 200), the entire affected
document suite was rerun and passed 28/28. Counts above describe the final verified
results, not a claim that the earlier combined run had no failures.

The expanded isolated PostgreSQL fixtures preserve rate limiting by using
distinct synthetic actor IPs, start closure checks from a clean cart and maintain
required assignment timestamp invariants. Real development data was not used for
destructive test cases.

Additional checks:

- OpenAPI generation + shared-library TypeScript build: PASS.
- API TypeScript check: PASS.
- Customer TypeScript check: PASS.
- Dashboard production build: PASS.
- Customer Expo web export: PASS.
- Dashboard full TypeScript check: **97 existing diagnostics** in
  `admin.test.tsx`, `delivery-partner.test.tsx`, `vendor-orders.test.tsx` and
  `vite.config.ts`; no changed application-source diagnostics. These unrelated
  errors were not fixed.
- API, Dashboard and Customer managed previews restarted and running cleanly.
- Development health request: 200; unauthenticated Submit and Approve: 401.
- Static Customer sign-in screenshot at 390×844 rendered successfully. Its
  capture recorded a nonspecific 404 resource warning and native-web form warning;
  this is not authenticated feature acceptance.
- **No automated browser tests were run.** Authenticated visual/interaction
  acceptance remains the manual checklist below.

## Manual checklist — ten steps

Use test accounts/data. Repeat changed controls at 320, 360, 390 and 414px, plus
desktop, checking no horizontal overflow.

1. **Close current hours:** As Vendor, close today's operating hours. As Customer,
   browse that active store; confirm “Currently Closed,” unchanged stock labels
   and disabled Add/variant actions.
2. **Retained cart and direct denial:** With a pre-existing cart, confirm items
   remain visible and checkout is disabled. Retry Instant and Scheduled checkout
   requests directly: closure must reject without new orders, stock deductions or
   delivery records. Removing/decreasing items should remain possible.
3. **Own-product search:** As Vendor A, try partial/mixed-case name and brand
   searches, combine with categories, then clear. Confirm stable order and no
   Vendor B private rows; Master Catalog search remains separate.
4. **Instant regression:** Reopen hours and place a test Instant order. Confirm
   INSTANT/null window, normal stock deduction and unchanged Vendor/Partner
   assignment and delivery flow.
5. **Scheduled options:** Select Scheduled using a served address. Check today's/
   tomorrow's dates, one-hour opening-aligned windows, no past/closed periods,
   loading/retry/refresh and stale-choice clearing after an address change.
6. **Scheduled persistence and replay:** Place one Scheduled order. Check matching
   window in Customer list/detail and Vendor orders. Retry the same intent: no
   second order/deduction. Later hour edits must not rewrite the accepted snapshot.
7. **Partner timing:** Assign that order when ready. Confirm Partner sees the
   window and may accept early but cannot pick up/start early. At or after its
   start, refresh and complete the normal pickup/start/delivered transitions.
8. **New Vendor submission:** Upload all four mandatory files. Catalog remains
   locked before and after Submit. Confirm SUBMITTED/receipt in Admin, mandatory
   replacements blocked during review and optional uploads still informational.
9. **Reject/correct/approve:** As Admin, reject PAN with a reason. Confirm Vendor
   sees it and stays locked, can replace PAN and resubmit, and old receipts cannot
   approve the new submission. Approve the current receipt; catalog unlocks and
   optional files are not labeled approved. Verify private current-version views.
10. **Compatibility and role checks:** Verify an existing exempt Vendor still has
    catalog access and is not falsely labeled verified. Check anonymous,
    Customer, Delivery Partner and Vendor attempts at review are denied; Vendor A
    cannot read Vendor B documents. Check Admin directory/detail indicators and
    normal catalog, cart, Vendor orders and mobile navigation.

## Final status

The four requested changes are implemented, the development migration is applied
and previews are running. The authenticated manual checklist has not been claimed
as completed. No publishing, automatic dispatch infrastructure or unrelated fixes
were added.
