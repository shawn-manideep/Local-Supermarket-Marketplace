# Phase 3 Business Rules

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