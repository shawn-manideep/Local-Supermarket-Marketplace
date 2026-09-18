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