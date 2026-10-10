# Handling Fee and Today’s Scheduled Delivery — Implementation Report

## Result

Implemented in the existing marketplace without redesigning the portals or
publishing the application.

- **Vendor:** Store profile → Store operations → Handling fee (₹).
- **Admin:** Vendor management → selected Vendor → Edit profile → Store operations
  → Handling fee (₹). The existing vendor-provisioning form also uses this shared
  field.
- **Customer:** Cart totals appear as Subtotal, Delivery fee, Handling Fee, Total.
  Accepted-order details and existing Vendor/Admin receipts show the snapshotted fee.

## Authoritative storage, validation and permissions

There is one current fee: `stores.handling_fee`, a non-null `numeric(12,2)` amount
defaulting to zero. Vendor and Admin read/write this same setting through their
existing authorized APIs.

The shared validator accepts zero and valid decimal money with at most two decimal
places, up to the existing settings limit of ₹1,000,000. Negative, malformed,
non-finite, over-limit and excess-precision inputs are rejected. Forms submit the
original amount text rather than converting malformed values into zero.

Vendor writes resolve the authenticated Vendor’s own store; injected store IDs are
rejected. Admin writes require the Admin role and retain the existing transactional
`vendor_profile_updated` management audit. Fee-only edits do not change product
prices, stock, store status, delivery fees, minimum-order settings or operating hours.
Direct authenticated database reads/writes of the new store fee remain prohibited.

## Cart, checkout and accepted orders

One server pricing helper computes integer-cent totals for cart reads, checkout
validation and order creation:

`Total = Subtotal + Delivery Fee + Handling Fee`

The existing pricing flow has no separate active discount or additional-charge
calculation to replace. Existing subtotal-based minimum-order and commission
calculations are unchanged. Final totals are checked before stock writes and must
fit the existing order money column.

Cart mutations and store switches already reload authoritative cart data. An open
cart additionally refreshes prices on focus/app resume and every 30 seconds while
active. Refresh results do not overwrite in-flight quantity changes or another
cart. Network failures retain the verified cart and display the existing error
message; order submission still revalidates on the server.

Checkout validation uses the same helper. Order creation locks the store/cart and
uses current server prices and fees; client-owned fees, subtotals and totals are
rejected by the strict request schemas.

Accepted orders copy the fee into `orders.handling_fee_snapshot`. A database trigger
rejects subsequent changes to that snapshot. Changing the current store fee never
recalculates an accepted order, its total, commission, inventory effects or delivery
window. Historical snapshots default to zero without rewriting historical totals.

## Today and Tomorrow

Inspection confirmed the existing scheduler already generates Today/Tomorrow
one-hour slots using `Asia/Kolkata` and the store’s operating hours. The existing
Customer selector derives dates from eligible slots instead of hard-coding dates.

- Today appears only when a complete future one-hour slot remains.
- Tomorrow appears only when it has eligible slots.
- Started/expired slots are excluded; if Today has none, the selector falls forward
  to the next eligible date.
- Existing entry, 25-second scheduled-slot refresh and focus/app-resume behavior
  remain. Changing the selected date now requests fresh availability as well.
- The server rechecks the exact selected window with a fresh timestamp at the
  stock-write boundary, after potentially waiting for product locks.
- Invalid/expired scheduled requests do not commit an order or stock deduction.
- Instant Delivery closure rules, valid future scheduling while closed, and
  fulfillment/status transitions are unchanged.

## Migration and data safety

Added `database/migrations/0023_store_handling_fee.sql` and registered it in the
existing source migration journal. Applied it once through the established
**development Supabase migration history**, not by replaying the partial local
Drizzle journal. No earlier approved migration was edited.

The migration adds:

1. `stores.handling_fee`, default zero, with a non-negative/settings-limit check.
2. `orders.handling_fee_snapshot`, default zero, with the same checks.
3. An immutable accepted-order fee trigger.
4. Read permission for the order snapshot under existing order RLS; no direct
   authenticated store-fee read/write permission.

Before/after checks confirmed unchanged counts: 7 stores, 29 orders, 59 products,
114 variants, 68 carts and 23 profiles. Full-row fingerprints of existing stores
and orders, excluding only their new columns, matched exactly. All seven current
store fees and all 29 historical snapshots defaulted to zero. No historical total
was recalculated. No production publishing/deployment action was taken.

## Exact files changed

### Customer components and response types

- `apps/customer/src/CartScreen.tsx` — fee breakdown, safe price refresh, date-selection refresh.
- `apps/customer/src/OrdersScreen.tsx` — accepted-order fee snapshot display.
- `apps/customer/src/lib/api.ts` — cart/order fee response fields.

### Vendor/Admin components and response types

- `apps/dashboard/src/StoreProfileFields.tsx` — shared Handling fee input.
- `apps/dashboard/src/VendorStorePanel.tsx` — original amount text in Vendor save payload.
- `apps/dashboard/src/admin/AdminPortal.tsx` — Admin save/create payload and current-fee summary.
- `apps/dashboard/src/admin-api.ts` — Admin input type.
- `apps/dashboard/src/api.ts` — store/order response types.
- `apps/dashboard/src/VendorOrderReceipt.tsx` — fee snapshot receipt row.
- `apps/dashboard/src/OrderOperations.tsx` — existing order-detail totals row.

### API, validation and database

- `packages/validation/src/index.ts` — shared handling-fee validator.
- `backend/api/src/store-management/routes.ts` — own-store persistence.
- `backend/api/src/admin-management/vendor-profile.ts` — Admin persistence.
- `backend/api/src/customer-cart/pricing.ts` — new shared integer-cent pricing helper.
- `backend/api/src/customer-cart/routes.ts` — authoritative cart/checkout fee reads and totals.
- `backend/api/src/orders/routes.ts` — authoritative snapshot/total and fresh slot-time validation.
- `lib/db/src/schema/index.ts` — fee and snapshot mappings.
- `database/migrations/0023_store_handling_fee.sql` — additive migration.
- `database/migrations/meta/_journal.json` — source registration.
- `lib/api-spec/openapi.yaml` — fee input/store response/order snapshot contract.

### Regenerated contract files

- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/customerCheckoutOutcomeOrder.ts`
- `lib/api-zod/src/generated/types/handlingFeeInput.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/storeProfile.ts`
- `lib/api-zod/src/generated/types/storeProfileInput.ts`
- `lib/api-zod/src/generated/types/vendorProfileInput.ts`
- `lib/api-zod/src/generated/types/vendorProvisionInput.ts`

### Tests and documentation

- `backend/api/src/customer-cart/handling-fee.test.ts` — money, totals, manipulated payloads and eligible/expired slots.
- `backend/api/src/admin-management/vendor-profile.integration.test.ts` — persisted fees, authorization/isolation, real HTTP cart/checkout/order flow, immutable snapshots and stock safety.
- `backend/api/src/admin-management/management.integration.test.ts` — repair the lightweight Auth fixture for existing migration replay.
- `backend/api/src/orders/inventory-contracts.test.ts` — align the retry-identity assertion with existing implementation.
- `apps/dashboard/src/vendor-profile.test.tsx` — shared fee constraints and saved/default values for both form variants.
- `.agents/memory/order-lifecycle-boundary.md` — preserve the user’s future-orders-only pricing constraint.
- `docs/HANDLING_FEE_SCHEDULED_DELIVERY_REPORT.md` — this report.

## Verification results

| Check | Result |
|---|---|
| Relevant API cart, orders, store-management and admin-management suites | **172 passed, 0 failed, 2 skipped** (174 discovered) |
| Existing Customer tests | **68 passed** |
| Dashboard profile/receipt tests | **24 passed** |
| Existing localization tests | **25 passed** |
| Workspace library typecheck | **Passed** |
| API typecheck | **Passed** |
| Dashboard typecheck | **Passed** |
| Customer typecheck | **Passed** |
| API/shared validation/database build | **Passed** |
| Dashboard Vite build | **Passed**, 113 modules |
| Customer Expo web export | **Passed**, 475 modules, 1.42 MB bundle |
| OpenAPI generation and generated-library typecheck | **Passed** |
| Existing managed API/Dashboard/Customer workflows | **Running after restart** |
| 390px public signed-out preview captures | Both portals render; not authenticated acceptance evidence |

Commands:

```sh
pnpm --filter @workspace/api exec tsx --test \
  src/customer-cart/*.test.ts src/orders/*.test.ts \
  src/store-management/*.test.ts src/admin-management/*.test.ts

pnpm --filter @workspace/api exec tsx \
  --tsconfig ../../apps/customer/tsconfig.json --test \
  ../../apps/customer/src/lib/*.test.ts \
  ../../apps/customer/src/home-marketplace.test.ts \
  ../../apps/customer/src/marketplace-scrolling.test.ts

pnpm --filter @workspace/api exec tsx \
  --tsconfig ../../apps/dashboard/tsconfig.json --test \
  ../../apps/dashboard/src/vendor-profile.test.tsx \
  ../../apps/dashboard/src/vendor-orders.test.tsx

pnpm --filter @workspace/localization test
pnpm run typecheck:libs
pnpm --filter @workspace/api typecheck
pnpm --filter @workspace/dashboard typecheck
pnpm --filter @workspace/customer typecheck
pnpm --filter @workspace/api build
pnpm --filter @workspace/dashboard build
pnpm --filter @workspace/api-spec run codegen
```

Customer export was performed by restarting its existing managed workflow, which
exports Expo web to `/tmp/phase12-customer-web` and serves that output.

### Failures corrected and limitations

- Initial full migration replay exposed older test Auth stubs without `created_at`.
  Repaired the two relevant fixtures; no approved migration was altered.
- Updated one stale source assertion expecting the cart ID as retry key. The
  existing stable checkout-intent UUID behavior was not changed.
- Corrected new HTTP test payloads to use the existing required `paymentMethod`
  and `cartId` contract. Final test runs pass.
- The first codegen invocation generated files but timed out during its subsequent
  library typecheck. Final codegen/library typecheck completed successfully.
- Two existing opt-in **real Supabase vendor provisioning/login** tests were
  skipped; isolated database/HTTP permission and fee tests passed.
- No automated browser journey tests were run, as requested. Public captures do
  not prove authenticated settings/cart interactions; those remain for manual
  preview acceptance. The Customer capture logged a resource 404 without preventing
  the sign-in screen from rendering.
- Customer localization files, dictionaries, fonts and preference behavior were
  untouched. The new **Handling Fee** label intentionally remains English,
  including when the existing Telugu interface is selected.
- Open-cart fee refresh is polling/focus/resume based, not a realtime push
  subscription; a foreground cart refreshes within 30 seconds. Order acceptance
  always uses fresh authoritative server values.

## Manual acceptance checklist

1. **Vendor:** Save ₹0, then ₹5.25; reload the profile and confirm persistence.
   Try a negative or malformed amount and confirm it is rejected. Confirm another
   Vendor’s own profile is unaffected.
2. **Admin:** Edit the same Vendor’s fee to ₹8.50. Reload both profiles; confirm
   they agree and delivery fee, status, prices and stock are unchanged.
3. **Customer cart:** Confirm Subtotal → Delivery fee → Handling Fee → Total,
   including a visible zero fee. Change quantities, switch stores and update the
   store fee from another session. Refocus/resume or wait up to 30 seconds and
   confirm the current breakdown and total refresh.
4. **Accepted order:** Place an order, then change the store fee. Confirm the
   accepted-order fee and total remain unchanged.
5. **Scheduled delivery:** For an open store with remaining full future slots,
   verify Today and Tomorrow. Near closing, confirm Today disappears when no full
   slot remains. Change dates and resume checkout; verify fresh availability.
6. **Expiry/closure:** Let a selected slot expire before submission; confirm
   rejection with no new order or stock deduction. While closed, confirm Instant
   is unavailable and Scheduled is offered only for a valid future slot.
7. **Languages/mobile:** Check both existing Customer languages and the narrow
   mobile layout. Other labels retain their existing translations; Handling Fee
   is English by scope.

No application was deployed or published.
