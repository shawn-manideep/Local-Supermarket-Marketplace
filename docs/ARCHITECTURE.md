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