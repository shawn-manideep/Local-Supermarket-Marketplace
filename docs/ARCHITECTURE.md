# Phase 2 Architecture

Supabase Auth owns authenticated identities. The application database stores one
`user_profiles` row per Supabase Auth user and assigns one application role:
`customer`, `vendor`, or `admin`.

Customers have a one-to-one `customers` profile. Vendors have a one-to-one
`stores.owner_user_id` relationship, enforced by a unique index. Admins are
manually provisioned and there is no public admin signup or role-assignment API.

Drizzle is the application schema source of truth. PostgreSQL migration SQL
contains the database objects Drizzle cannot model completely, including the
`auth.users` relationship, new-user trigger, and Supabase RLS policies.

The backend auth foundation verifies Supabase Auth access tokens through
Supabase Auth and resolves the application role and vendor store relationship
from the database. No marketplace endpoints are registered in this phase.

## Phase 3 management layer

The Express API now exposes a focused store-management router. Vendor routes
derive the store from `AuthenticatedRequest.auth.storeId` and only update
vendor-editable fields. Admin routes use explicit status-action endpoints and a
separate commission-rate endpoint; there is no generic status mutation route.

The dashboard remains a simple React/Vite management surface. It does not
implement authentication screens; it accepts a current Supabase access token in
page state so the existing Auth foundation can be connected without creating a
second identity system.

## Phase 4 catalog layer

Catalog ownership follows `Store → Categories → Products`. Category and product
routes resolve the vendor store from authenticated request context and scope
every lookup and mutation to that store. Category assignment is verified in the
API and by the existing composite database foreign key.

Products are independent store records; there is no global product entity or
join-style `store_products` model. The dashboard adds vendor-only catalog
management while the customer app and admin ownership model remain unchanged.

## Phase 5 customer application

The Expo application uses Supabase Auth for signup, signin, signout, session
restoration, and session-change handling. Protected Home, Account, and Addresses
views share the authenticated session. The Express API derives customer
ownership from the verified Supabase user and persists profile/address data
through Drizzle.

## Phase 6 discovery and catalog

Discovery follows saved customer address pincode → ACTIVE store service pincode
→ selected store → that store's active categories/products. Store context and
pincode remain explicit in every catalog request. Operating status is computed
from weekly hours in the India MVP timezone; it never changes approval status.

## Phase 7 cart boundary

The server is the cart and financial source of truth. An ACTIVE cart belongs to
one customer and one supermarket; item products must belong to that store.
Cross-store adds require confirmation and preserve the previous cart as
ABANDONED. Checkout is validation-only: it prepares current COD totals and an
owned saved-address snapshot candidate, without writing any order table.

## Phase 8 order boundary

Order creation is a cart-to-order conversion boundary. The API revalidates all
customer, address, store, catalog, stock, minimum-order, and financial values
against current rows rather than trusting the Phase 7 cart's earlier values.
Creation, order-item insertion, initial `PLACED` history, and `CONVERTED` cart
update run in one PostgreSQL `SERIALIZABLE` transaction. A per-customer
advisory transaction lock and row locks serialize competing checkout requests.
The implementation intentionally does not reserve or deduct stock.

Orders own immutable-at-creation financial, delivery-address/contact, and
product identity/name/price snapshots. Their customer and store ownership
identity cannot be changed. Status changes are a legal state machine and every
change appends a status-history row. Vendor actions derive store ownership from
the authenticated vendor. The initial delivery foundation is `vendor_staff`;
COD is recorded as unpaid at placement. Commission is calculated over bigint
cents with half-up rounding, using an explicit `0.00%` fallback when no
previous platform default exists.

Phase 8 does not add payment, settlement, inventory, delivery-partner,
notification, reporting, or production deployment architecture. Those remain
future work.

## Phase 9 vendor/admin order operations

Phase 9 extends the existing order boundary with two read models. Vendor order
list and detail queries derive the store from authenticated vendor context and
are therefore bounded to that vendor's own store. The vendor list is paginated
and can filter by status; it returns total pagination data and counts for every
status. Vendor lifecycle actions use the existing locked order state machine,
append history, and return `409 Conflict` for illegal or stale transitions so
the dashboard can refresh its detail and queue.

Admin order list and detail queries are protected by the `admin` role and span
the platform without mutation capability. The list is paginated and supports
status, store, and creation-date filters, with filtered totals and status
counts. Admin detail adds commission rate and amount snapshots for oversight;
these snapshots are not exposed to vendors or customers. No admin order action
or generic status write is introduced.

The architecture continues to treat order-time address, contact, item,
financial, and commission values as immutable historical snapshots. Strict
request schemas and authenticated context, rather than client store, customer,
or status fields, determine authority. Phase 9 adds no migration, realtime
channel, or stock deduction and does not alter customer or catalog flows.
Phase 10 delivery is documented below. Phase 11+ features, payments,
delivery-partner integration, and deployment remain outside the
implementation.

## Phase 10 vendor-owned delivery

Phase 10 operationalizes the existing order lifecycle rather than creating a
delivery subsystem. The MVP delivery model is `vendor_staff`: the supermarket
uses its own staff, and the authoritative transitions remain `READY` →
`OUT_FOR_DELIVERY` → `DELIVERED`. Vendor actions continue through
`POST /api/vendor/orders/:orderId/actions`; no parallel delivery endpoint,
delivery order, or delivery state machine exists.

The vendor dashboard adds a focused queue/filter for `READY`,
`OUT_FOR_DELIVERY`, and `DELIVERED`. Vendor detail uses immutable order
snapshots for recipient/contact, full address (including city, state, and
pincode), delivery type, reference, item count, totals, status, and history.
Customer detail presents a customer-friendly Vendor Delivery label and the
existing append-only status timeline. Admin order oversight remains read-only
and can see delivery fields and history.

Delivery actions use the existing order lock and legal transition map:
`OUT_FOR_DELIVERY` moves `READY` to `OUT_FOR_DELIVERY`, and `DELIVER` moves
`OUT_FOR_DELIVERY` to `DELIVERED`. Stale or duplicate actions are rejected
with the existing conflict behavior, preventing duplicate history; delivered
orders cannot reopen. Delivery does not mutate address/contact snapshots,
delivery fee, subtotal, total, catalog data, or payment state. COD remains
unpaid at placement.

No schema migration is required. There are no GPS/maps, location tracking,
delivery partners or agents, separate delivery application, realtime,
notifications, payment processing, or stock changes in Phase 10. The
`platform_partner` value remains future extensibility only.