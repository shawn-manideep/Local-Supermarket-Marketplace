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