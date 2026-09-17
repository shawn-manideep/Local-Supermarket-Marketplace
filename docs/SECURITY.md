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