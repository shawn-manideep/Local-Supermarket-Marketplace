# Business Rules — Phases 3–4

## Vendor stores

- A vendor may own at most one store.
- Vendor store access is derived from the authenticated user profile.
- Vendors may update store name, description, logo URL, phone, delivery fee, and
  minimum order value.
- Vendors may view their status but cannot change approval, suspension, or
  rejection state.
- Vendors cannot change ownership or commission rate.

## Store status

The only statuses are `PENDING_APPROVAL`, `ACTIVE`, `SUSPENDED`, and `REJECTED`.
Only admins can perform these transitions:

- Pending → Active
- Pending → Rejected
- Active → Suspended
- Suspended → Active

Arbitrary status updates are not exposed.

## Commission

- `commission_rate` is optional and store-specific.
- Admins can set or clear the rate.
- A null rate means future order calculations may use the platform default.
- Vendors cannot change the rate.
- Order commission snapshots are historical and immutable.
- Settlement, payout, payment, invoice, and commission reporting are not part
  of Phase 3.

## Service pincodes

- Vendors can add, list, and remove pincodes for their own store.
- Pincodes use the six-digit India-first format and are unique within a store.
- Maps, GPS, geolocation, delivery radii, and location services are out of
  scope.

## Operating hours

- Vendors can view and upsert one weekly day at a time.
- Days use `0` for Sunday through `6` for Saturday.
- Open days require 24-hour `HH:MM` opening and closing times.
- Closed days store `is_closed = true` and null opening/closing times.
- Holiday calendars and timezone-specific scheduling are out of scope.

## Store-owned catalog

- Categories and products belong to exactly one store.
- There is no global category or product master and no `store_products` table.
- Identically named products in different stores are independent records.
- A product may be uncategorized or assigned only to a category from its own
  store.

## Category lifecycle

- Categories are activated/deactivated with `is_active`.
- Categories are never hard-deleted.
- Deactivating a category does not delete or deactivate its products.

## Product identity and lifecycle

- Product names are not identifiers and are not globally unique.
- SKU and external code are optional. Non-null values are unique per store, not
  globally.
- `is_active = false` means disabled or discontinued.
- `availability = false` means temporarily unavailable while the product may
  remain active.
- Changing availability never changes active status.
- Products are never hard-deleted because historical records may reference
  them.

## Price, stock, and images

- Current price is non-negative, decimal, and limited to two decimal places.
- Updating current price does not change historical order-item snapshots.
- Stock quantity is a non-negative integer. Phase 4 does not add an inventory
  ledger, automatic deductions, warehouse management, or synchronization.
- Image references use the existing optional URL field. No storage or
  image-processing provider is introduced.