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