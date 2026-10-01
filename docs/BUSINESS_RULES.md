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
- Platform-level `master_categories` and `master_products` supply canonical
  catalog data. The existing store-owned products remain listings; there is no
  replacement `store_products` table or shared `master_variants` structure.
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

## Master Catalog foundation

- Master identity follows the product-family model. Pack sizes are selling
  variants; materially different brands/types/specifications remain distinct.
- Vendors search the complete eligible catalog with backend pagination, without
  choosing a category first. Category is an optional filter.
- New vendor additions use canonical selection or the same validated canonical
  creation flow after reviewed global duplicate checks.
- New selections reuse an existing listing and serialize concurrent additions.
  No uniqueness constraint is imposed on legacy duplicate listings.
- New selections start inactive with no artificial selling variant. Vendors
  explicitly configure a real variant before activation. A required legacy
  product-price placeholder is not a published selling offer.
- Canonical names/brands remain master-controlled. Local description/image
  overrides are nullable; null means inherit the current canonical default.
  Store categories remain independent merchandising groups.
- Master archive blocks new selections, not existing store eligibility; it does
  not delete or cascade-deactivate listings, variants, carts, or orders.
- Store removal deactivates the listing and preserves IDs and configuration for
  deliberate reuse/reactivation.
- Legacy unmapped products/categories continue working. Mapping is privileged,
  reasoned and append-only audited; a different physical product is not a
  clerical correction or a reorder substitution.
- Customer global discovery includes only authorized, active store offers for
  the saved-address pincode. Purchases remain tied to the selected store and the
  original product/variant IDs.
- Customer catalog responses include server-derived purchasability, not SKU,
  external codes, exact stock or internal timestamps. Current stock is still
  validated by cart/checkout/order APIs.
- Units also support bottle and box. No automatic conversion, stock reservation
  or deduction is introduced.
- Existing historical snapshots remain immutable; current canonical names are
  resolved for cart presentation and newly created order snapshots only.

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

## Phase 9 vendor/admin order operations

- Vendor order queues contain only orders for the vendor's authenticated store.
- Vendor lists are bounded and paginated, may filter by status, and expose
  total pagination data plus counts for each order status.
- Vendors may view their store's order detail and may perform only the legal
  `ACCEPT`, `PREPARE`, `READY`, `OUT_FOR_DELIVERY`, `DELIVER`, and `REJECT`
  actions.
- Vendor actions are serialized against the order. Illegal or stale actions
  return `409`; the client refreshes the affected detail and queue rather than
  treating stale state as success.
- Admins may read a platform-wide bounded, paginated order list and detail.
  Admin filters include status, store, and creation-date range, and counts
  respect the store/date scope. Admin order access is read-only.
- Commission rate and amount snapshots are admin-only oversight values. They
  are historical and immutable, like the delivery/contact, item, price, fee,
  subtotal, and total snapshots.
- Store, customer, status, financial, actor, and snapshot authority comes from
  authenticated roles and server/database state; clients cannot choose these
  values. Vendor store scope is never taken from a client-provided store ID.
- Phase 9 does not add realtime behavior, stock deduction or reservation, or a
  database migration. Existing customer and catalog rules remain unchanged.

## Phase 9+ and production exclusions

Inventory reservation/deduction, payment processing, refunds, settlement,
invoicing, partner delivery, notifications, promotions, taxes, order editing,
ratings, analytics, and production deployment are not Phase 9 behavior.
Phase 10 delivery is documented below. Phase 11+ functionality is not
implemented.

## Phase 10 vendor-owned delivery

- The MVP delivery type is `vendor_staff`; the vendor is responsible for
  delivery with its own staff. `platform_partner` remains future
  extensibility and is not operational.
- Delivery is part of the existing order lifecycle, not a separate delivery
  lifecycle or order. The legal delivery transitions are `READY` →
  `OUT_FOR_DELIVERY` and `OUT_FOR_DELIVERY` → `DELIVERED`.
- Vendors may perform those transitions only on orders belonging to their
  authenticated store. Customers cannot perform delivery actions, and admins
  retain read-only oversight rather than bypassing lifecycle rules.
- Both delivery transitions use `POST /api/vendor/orders/:orderId/actions`,
  the existing lifecycle service, order locking, and append-only status
  history. Illegal, duplicate, or stale actions are rejected safely; the
  delivered state is terminal and cannot reopen.
- The vendor delivery queue makes `READY`, `OUT_FOR_DELIVERY`, and `DELIVERED`
  orders easy to filter. Vendor fulfilment views show only information needed
  for the vendor's own orders: recipient/contact, immutable full address,
  pincode, reference, item count, delivery type, total, current status, and
  history.
- Customers see only their own delivery information and status history.
  `vendor_staff` is presented as **Vendor Delivery**, not unexplained internal
  terminology. Admins may see delivery type, status, contact, address, and
  history platform-wide under the existing admin role.
- Recipient/contact/address values and delivery fee, subtotal, and total are
  immutable order-time snapshots. Delivery actions never read mutable address
  data for historical fulfilment, recalculate fees, change financial values,
  or alter catalog data.
- Delivery remains COD and unpaid at placement. Phase 10 adds no payment
  capture, payment-success state, surcharge, distance pricing, or stock
  reservation/deduction.
- Pincode and the stored address are the only delivery-location mechanisms.
  GPS, maps, live location, route calculation, delivery partners/agents,
  proof of delivery, realtime, and notifications are out of scope.
- No new delivery table, endpoint, migration, or dependency is needed.

## Phase 11 hardening rules

- API reads are limited to 300 requests per client IP per minute; mutations
  are limited to 60 per client IP per minute; customer order creation is
  limited to 10 per client IP per minute. These limits are dependency-free and
  enforced at the trusted proxy/API boundary. Exceeding a limit returns 429
  with `Retry-After`.
- JSON request bodies may not exceed 100 KB. Oversized requests return 413 and
  malformed JSON returns 400 without leaking implementation details.
- List endpoints have a maximum page size of 100. Admin order date windows may
  span no more than 366 days. Customer order lists are deterministically
  sorted newest-first by creation time and ID.
- Production-facing unhandled errors are generic and do not disclose secrets,
  SQL, stack traces, or internal paths.
- Marketplace operating-hours reads no longer perform an N+1 query pattern.
  Frontend duplicate/stale request guards prevent obsolete responses from
  replacing current state, and controls have accessible labels.
- Migration 0004 is forward-only: it revokes unnecessary function privileges,
  protects store identity columns from reassignment, makes carts private to
  customers (with intentional admin visibility), and adds order-list indexes.
  Migration 0003 remains approved and unchanged.

Phase 11 is hardening only. It adds no payment, deployment, production
configuration, or other Phase 12 functionality.