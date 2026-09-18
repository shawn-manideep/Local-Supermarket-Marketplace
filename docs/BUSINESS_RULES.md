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

## Customer accounts and addresses

- Public signup creates only customer accounts; clients cannot choose roles.
- Customers may update only their own name and phone.
- Customers may manage only their own reusable addresses.
- Setting one address as default clears the previous default transactionally.
- Deleting a reusable address does not alter historical order snapshots.

## Customer marketplace visibility

- Customers discover only ACTIVE stores serving a pincode from their saved
  addresses.
- OPEN/CLOSED is computed from weekly hours and is separate from approval
  status.
- Customers see only active categories and active products from the selected
  store.
- Active unavailable products remain visible and clearly unavailable.
- Catalog browsing never merges products between stores.

## Cart and checkout preparation

- One cart contains products from one supermarket only.
- A confirmed store switch marks prior ACTIVE carts ABANDONED; carts are not
  hard-deleted or merged.
- Empty carts may remain ACTIVE. Explicit cart clearing marks the cart
  ABANDONED and preserves its items as historical cart data.
- Add and quantity updates require active, available products and cannot exceed
  current stock. Phase 7 does not deduct stock.
- Prices, line subtotals, subtotal, current delivery fee, and total are computed
  server-side with integer cents. There are no discounts or taxes.
- Checkout requires an owned saved address served by the ACTIVE store and a
  subtotal meeting its current minimum order value.
- COD is the only accepted payment method.
- Checkout preparation is allowed outside store operating hours; OPEN/CLOSED is
  shown for discovery but is not a newly invented checkout restriction.
- Validation does not create an order or convert the cart.

## Phase 8 order creation and conversion

- Order creation accepts only an owned saved address and `COD`; customer and
  store ownership are derived from authentication and cart rows.
- The server revalidates current store ACTIVE status and address service area,
  product ownership/category relationships, active/available state, stock,
  minimum order, prices, delivery fee, and totals during creation.
- Creation is one READ COMMITTED transaction: it first takes the per-customer
  advisory transaction lock, then locks the customer's active
  cart and relevant rows, inserts the order, items, and initial history, and
  converts the cart. Concurrent checkout attempts cannot create duplicate
  conversions. Stock is neither deducted nor reserved.
- Orders preserve delivery address/contact, product name/price, fee, subtotal,
  total, and commission snapshots. Later edits to reusable addresses,
  catalog values, store values, or commission cannot rewrite history.
- Financial calculations use bigint integer cents. Commission is half-up
  rounded. If no store commission exists, the effective rate is explicitly
  `0.00%`: there is no prior platform default configuration to consult.
- COD is unpaid at placement. The current delivery foundation is
  `vendor_staff`; payment capture, refunds, settlement, and external delivery
  partners are excluded.
- Order creation is allowed outside store operating hours. Hours affect
  discovery status but do not add an order-time restriction.

## Order lifecycle, ownership, and history

- Customers may list and view only their own orders and may cancel only
  `PLACED` orders.
- Vendors may list and mutate only orders belonging to their authenticated
  store. Vendor actions are `ACCEPT`, `PREPARE`, `READY`, `OUT_FOR_DELIVERY`,
  `DELIVER`, and `REJECT`, with only the legal transitions documented in the
  API specification.
- Every transition appends history; arbitrary status writes are not exposed.
  History is append-only, and order/customer/store and order-item identity are
  immutable.

## Phase 9+ and production exclusions

Inventory reservation/deduction, payment processing, refunds, settlement,
invoicing, partner delivery, notifications, promotions, taxes, order editing,
ratings, analytics, and production deployment are not Phase 8 behavior.