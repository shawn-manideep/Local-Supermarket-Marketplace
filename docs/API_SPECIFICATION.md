# Management API Specification — Phases 3–4

All management routes use JSON and require a Supabase Auth bearer token:

`Authorization: Bearer <access-token>`

The backend derives the vendor store from the authenticated user. A
client-provided `storeId` is never used as the vendor authorization source.

## Vendor store

### `GET /api/vendor/store`

Returns the authenticated vendor's store, including its current status and
commission rate. The commission rate is informational to the vendor.

### `PATCH /api/vendor/store`

Updates only permitted operational fields:

```json
{
  "name": "Fresh Basket",
  "description": "Neighbourhood grocery store",
  "logoImageUrl": "https://example.com/logo.png",
  "phone": "+91 9876543210",
  "deliveryFee": 35.5,
  "minimumOrderValue": 250
}
```

`id`, `ownerUserId`, `status`, `commissionRate`, `createdAt`, and `updatedAt`
are not accepted.

## Vendor service pincodes

- `GET /api/vendor/store/pincodes`
- `POST /api/vendor/store/pincodes` with `{ "pincode": "560001" }`
- `DELETE /api/vendor/store/pincodes/:pincode`

Pincodes must be unique per store and must match the six-digit India-first
format.

## Vendor operating hours

- `GET /api/vendor/store/hours`
- `PUT /api/vendor/store/hours/:dayOfWeek`

`dayOfWeek` is an integer from `0` through `6`, where `0` is Sunday. The update
body is:

```json
{
  "isClosed": false,
  "opensAt": "09:00",
  "closesAt": "18:00"
}
```

Closed days must send `isClosed: true` with null opening and closing times.
Open days require valid 24-hour `HH:MM` times, with closing later than opening.

## Admin store management

All admin routes require an authenticated user with application role `admin`.

- `GET /api/admin/stores`
- `GET /api/admin/stores/:storeId`
- `POST /api/admin/stores/:storeId/approve`
- `POST /api/admin/stores/:storeId/reject`
- `POST /api/admin/stores/:storeId/suspend`
- `POST /api/admin/stores/:storeId/reactivate`
- `PATCH /api/admin/stores/:storeId/commission-rate`

The commission body is:

```json
{
  "commissionRate": 12.5
}
```

Send `null` to use the platform default for future orders.

Allowed status transitions are:

- `PENDING_APPROVAL` → `ACTIVE`
- `PENDING_APPROVAL` → `REJECTED`
- `ACTIVE` → `SUSPENDED`
- `SUSPENDED` → `ACTIVE`

Invalid transitions return `409 Conflict`.

## Vendor categories

All category routes require the `vendor` role and derive the store from the
authenticated user.

- `GET /api/vendor/categories`
- `GET /api/vendor/categories/:categoryId`
- `POST /api/vendor/categories` with `{ "name": "Staples" }`
- `PATCH /api/vendor/categories/:categoryId` with `{ "name": "Pantry" }`
- `POST /api/vendor/categories/:categoryId/activate`
- `POST /api/vendor/categories/:categoryId/deactivate`

Categories are deactivated with `isActive`; there is no hard-delete endpoint.

## Vendor products

All product routes require the `vendor` role. Product and category identifiers
are always checked against the authenticated vendor's store.

- `GET /api/vendor/products`
- `GET /api/vendor/products?categoryId=:categoryId`
- `GET /api/vendor/products/:productId`
- `POST /api/vendor/products`
- `PATCH /api/vendor/products/:productId`
- `POST /api/vendor/products/:productId/activate`
- `POST /api/vendor/products/:productId/deactivate`
- `PATCH /api/vendor/products/:productId/availability`
- `PATCH /api/vendor/products/:productId/price`
- `PATCH /api/vendor/products/:productId/stock-quantity`
- `PATCH /api/vendor/products/:productId/category`

Create and general update payloads use these catalog fields:

```json
{
  "name": "Tata Salt",
  "description": "Iodised salt",
  "sku": "SALT-1KG",
  "externalCode": null,
  "price": 28,
  "availability": true,
  "stockQuantity": 40,
  "imageUrl": "https://example.com/tata-salt.jpg",
  "categoryId": "11111111-1111-4111-8111-111111111111"
}
```

`sku`, `externalCode`, `description`, `imageUrl`, and `categoryId` may be null.
Price must be non-negative with at most two decimal places. Stock must be a
non-negative integer. `storeId`, `isActive`, IDs, and timestamps are rejected
from create/general update bodies.

Dedicated update payloads are `{ "availability": false }`, `{ "price": 29.5 }`,
`{ "stockQuantity": 25 }`, and `{ "categoryId": null }`.

Product `isActive` and `availability` are independent. Deactivation never
hard-deletes a product.

## Out of scope after Phase 4

There are no customer discovery/catalog, search, cart, checkout, order, payment,
delivery-partner, settlement, recommendation, or reporting APIs.

## Phase 5 customer account

All routes require the `customer` role and derive customer ownership from the
authenticated Supabase user:

- `GET /api/customer/profile`
- `PATCH /api/customer/profile`
- `GET /api/customer/addresses`
- `GET /api/customer/addresses/:addressId`
- `POST /api/customer/addresses`
- `PATCH /api/customer/addresses/:addressId`
- `DELETE /api/customer/addresses/:addressId`

Profile updates accept only `fullName` and `phone`. Address requests use the
existing recipient, phone, address-line, city, state, pincode, label, and
default fields. Clients cannot supply `customerId`.

## Phase 6 customer marketplace

All marketplace routes require the `customer` role and a `pincode` matching one
of the authenticated customer's saved addresses:

- `GET /api/customer/stores?pincode=:pincode`
- `GET /api/customer/stores/:storeId?pincode=:pincode`
- `GET /api/customer/stores/:storeId/categories?pincode=:pincode`
- `GET /api/customer/stores/:storeId/products?pincode=:pincode`
- `GET /api/customer/stores/:storeId/products?categoryId=:categoryId&pincode=:pincode`
- `GET /api/customer/stores/:storeId/products/:productId?pincode=:pincode`

Discovery returns only ACTIVE stores serving that pincode. Catalog responses
contain only public fields, active categories, and active products. Active but
temporarily unavailable products remain visible with `availability: false`.

## Phase 7 customer cart and checkout validation

All routes require the `customer` role:

- `GET /api/customer/cart`
- `POST /api/customer/cart/items`
- `PATCH /api/customer/cart/items/:itemId`
- `DELETE /api/customer/cart/items/:itemId`
- `DELETE /api/customer/cart`
- `POST /api/customer/checkout/validate`

Add-item payloads contain `productId`, positive `quantity`, and optional
`confirmStoreSwitch`. Quantity updates accept `0` to remove the item. The server
derives product/store ownership, prices, fees, minimums, and totals.

A cross-store add returns `409 Store switch required`. Repeating it with
`confirmStoreSwitch: true` abandons the previous cart and creates or reuses the
requested store's ACTIVE cart. Carts are never merged or hard-deleted.

Checkout validation accepts only `{ "addressId": "<uuid>", "paymentMethod":
"COD" }`. It revalidates ownership, store status/service area, products, stock,
minimum order, fee, and totals. It returns prepared checkout data but does not
create an order or mark the cart CONVERTED.

## Phase 8 customer orders

All order routes require the `customer` role. Customer ownership is always
derived from the authenticated user; a client cannot provide `customerId`,
`storeId`, prices, totals, fees, commission, or delivery snapshots.

- `POST /api/customer/orders`
- `GET /api/customer/orders`
- `GET /api/customer/orders/:orderId`
- `POST /api/customer/orders/:orderId/cancel`

Order creation accepts the same strict body as checkout validation:

```json
{ "addressId": "<uuid>", "paymentMethod": "COD" }
```

Creation performs current-value revalidation inside one READ COMMITTED
transaction after taking the per-customer advisory lock. It then locks the
customer's active cart, address, store, cart items,
and products; verifies address ownership and service coverage, ACTIVE store
status, product/store/category relationships, active and available products,
stock, and the current minimum order value; then computes subtotal, delivery
fee, and total from current database values. The address, contact details,
product names/prices, fee, and commission are stored as order-time snapshots.
Successful creation returns `201` with the order, items, and status history.
The active cart is converted to `CONVERTED` only in that same transaction.
There is no stock deduction or reservation.

The list endpoint returns customer-owned order summaries. The detail endpoint
returns only a customer-owned order and its immutable item and status-history
records. A customer may cancel only an order in `PLACED`; cancellation returns
the updated order and appends a `CANCELLED` history entry. Missing orders return
`404`; stale or illegal operations return `409`.

## Phase 8 vendor orders

Both routes require the `vendor` role and derive the store from the
authenticated vendor (never from a client-supplied store ID):

- `GET /api/vendor/orders`
- `POST /api/vendor/orders/:orderId/actions`

The list is scoped to the vendor's store. The action body is:

```json
{ "action": "ACCEPT", "note": "Optional note, up to 500 characters" }
```

`action` must be one of `ACCEPT`, `PREPARE`, `READY`, `OUT_FOR_DELIVERY`,
`DELIVER`, or `REJECT`. Legal transitions are respectively
`PLACED→ACCEPTED`, `ACCEPTED→PREPARING`, `PREPARING→READY`,
`READY→OUT_FOR_DELIVERY`, `OUT_FOR_DELIVERY→DELIVERED`, and
`PLACED→REJECTED`. Each action is ownership-checked, serialized, and appends
history; an illegal transition returns `409`.

Orders currently use `vendor_staff` delivery and `COD`. COD remains unpaid at
placement; payment capture, settlement, delivery-partner integration, and
other payment methods are not implemented. Orders may be created outside
operating hours; operating hours remain a discovery signal rather than a new
checkout restriction.

All money is represented in API responses as decimal strings from database
numeric values, but calculations use bigint integer cents. Commission uses
half-up rounding. When a store has no commission rate, the explicit fallback
is `0.00%` because no prior platform-default configuration exists; both the
effective rate and calculated amount are snapshotted.

## Phase 9+ and production exclusions

Inventory reservation/deduction, payments, refunds, settlement, invoices,
delivery partners, notifications, scheduled jobs, promotions, taxes,
multi-store orders, order editing, ratings, analytics, and production
deployment are not part of Phase 8.