# Phase 3 API Specification

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

## Out of scope

Phase 3 does not add product, category, customer discovery, cart, checkout,
order, payment, delivery-partner, settlement, or reporting APIs.