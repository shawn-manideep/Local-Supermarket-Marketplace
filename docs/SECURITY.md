# Phase 2 Security Foundation

## Authentication

Supabase Auth is the identity provider. The backend auth middleware accepts a
Supabase access token in the `Authorization: Bearer <token>` header and calls
Supabase Auth to establish the authenticated user ID. It then loads the
application role from `user_profiles` and, for vendors, resolves the authorized
store from `stores.owner_user_id`.

The backend does not implement password hashing, password verification, JWT
signing, or custom login flows.

## Role protection

The only application roles are `customer`, `vendor`, and `admin`. New public
Auth users are created as customers by a database trigger. Vendor and admin
provisioning is manual. No public role-assignment endpoint exists.

Vendor store ownership is unique and vendor store updates are prevented from
changing the owner or approval status. Future vendor operations must derive the
store from authenticated identity rather than accepting a client-supplied
`store_id`.

## Row-Level Security

RLS is enabled on all application tables:

- Customers can access only their own customer-owned resources.
- Vendors can access only their authorized store, including its categories,
  products, service pincodes, operating hours, carts for that store, and orders
  for that store.
- Admin access is explicitly role-controlled.
- Order items and status history are visible only through an authorized parent
  order.
- Profiles are visible only to the authenticated user or an admin.

The helper functions `current_app_role()` and `current_store_id()` run as
security-definer functions with a fixed `public` search path so policies do not
trust client-provided role or store fields.

## Secrets

`SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` are server-only values.
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are the public/client-safe configuration
pair. No credentials are committed to the repository, and the service-role key
is not used by customer or dashboard code.

## Phase 3 management authorization

Vendor store routes require the `vendor` role. The backend uses the
authenticated request context to scope every store, pincode, and operating
hours query. Store identifiers in admin resource paths are validated as UUIDs
and are protected by the admin role middleware.

Vendor store updates are allowlisted. Ownership, status, commission, and
timestamps cannot be supplied by the client. Database triggers provide a
second enforcement layer for vendor commission, status, and ownership
protection.

Admin status changes use explicit endpoints and the backend transition map.
The database RLS policies continue to require the admin role for admin store
management access.

The dashboard token field is held only in React page state and is not written
to local storage. A complete authentication UI remains outside this phase.

## Phase 4 catalog isolation

Every category and product endpoint requires the `vendor` role. The API derives
`storeId` from the authenticated vendor and combines it with category/product
IDs in every detail lookup and mutation predicate.

Client-provided store ownership fields are rejected by strict Zod schemas.
Assigning or filtering by a category first verifies that the category belongs
to the authenticated vendor's store. The existing composite foreign key and
RLS policies provide additional database enforcement.

Category/product hard-delete routes do not exist, and database triggers reject
direct hard-delete attempts. Malformed JSON is returned as a `400` client
error rather than an internal server error.

## Phase 5 customer isolation

Customer APIs require the `customer` role and use authenticated `userId` as the
customer identifier. Address detail, update, and delete predicates combine that
identifier with the address ID. Strict schemas reject `customerId`, role, and
other protected fields. The Expo bundle uses only public Supabase configuration
and never receives database or service-role credentials.

## Phase 6 marketplace authorization

Every marketplace request verifies the customer role, saved-address pincode,
ACTIVE store status, service-pincode eligibility, and store/category/product
relationships. Public projections omit owner IDs, commission, SKU, external
codes, stock quantity, approval internals, and timestamps. New SELECT-only RLS
policies mirror ACTIVE-store and saved-address pincode visibility without
changing vendor/admin mutation policies.

## Phase 7 cart authorization

Cart endpoints derive the customer from the verified session and scope every
cart/item lookup by that owner. Product store, lifecycle, availability, and
stock are read from PostgreSQL. Client prices, totals, fees, minimums, store
IDs, customer IDs, and arbitrary address data are rejected. Checkout accepts
only an owned saved-address ID and COD, then revalidates the ACTIVE store and
service pincode. Direct customer cart mutations are removed from RLS; writes
must pass through the API so lifecycle, store, stock, and financial invariants
cannot be bypassed with the public Supabase client. Existing read policies for
customers, vendors, and admins remain unchanged.

## Phase 8 order authorization and integrity

Customer order creation, listing, detail, and cancellation require the
`customer` role and scope every query to the authenticated customer. Vendor
listing and lifecycle actions require `vendor` and derive `storeId` from the
authenticated vendor context. Client-supplied ownership, prices, totals,
commission, snapshots, status, and actor fields are not trusted.

Creation revalidates current database values in a READ COMMITTED transaction
whose first statement takes the same per-customer advisory lock used by cart
mutations, with row locks covering the cart, address, store, products, and
relevant relationships. This protects conversion and
prevents concurrent stale-value orders; it does not reserve or deduct stock.
Vendor lifecycle actions lock the owned order and accept only the explicit
legal transition map. Operating hours are not used as an authorization or
creation gate.

Order delivery/address, contact, item, financial, and commission values are
snapshotted at creation. Migration 0003 adds database enforcement for
append-only status history, revokes direct authenticated/anonymous history
writes, removes broad direct admin order mutation, revokes direct public order
and order-item writes, preserves authorized SELECT visibility, and blocks
changes to order and order-item ownership identity. These controls protect
historical immutability even if current catalog or account data changes.

COD is recorded without payment capture and `vendor_staff` is the current
delivery type. Payment credentials, settlement, inventory, external delivery,
notifications, and production deployment are excluded from this phase.

## Phase 9 order operations authorization

Vendor order list, detail, and action endpoints require `vendor` and derive
`storeId` from the verified authenticated request context. Every vendor order
lookup and mutation combines the order ID with that store scope. Strict
validation accepts only the defined filters and lifecycle action/note fields;
client store, customer, status, actor, financial, and historical snapshot
fields are not trusted.

Admin order list and detail endpoints require `admin`. They are read-only,
support bounded status/store/date-filtered platform reads, and expose
commission snapshots only in admin detail. Admin routes do not provide order
status mutation or a general-purpose write path. Status counts are computed
server-side within the requested filter scope.

Vendor action transactions lock the owned order and accept only the explicit
legal transition map. A race or illegal transition returns `409 Conflict`;
the dashboard refreshes detail/list state rather than trusting stale client
state. Order and history protections continue to preserve immutable historical
values. Phase 9 requires no migration and adds no realtime channel or stock
deduction; existing customer/catalog isolation remains in force.