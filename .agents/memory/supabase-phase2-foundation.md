---
name: Supabase Phase 2 foundation
description: Runtime and migration boundaries for the Supabase-backed database and authentication foundation.
---

Keep Supabase database access lazy and require `SUPABASE_DB_URL` only when a database operation runs. Keep the health endpoint and static checks usable without Supabase credentials. Store RLS helpers, Auth profile creation, and database security triggers in the reviewable migration SQL alongside the Drizzle-generated schema.

**Why:** Phase 2 must be implementable and verifiable without inventing credentials, while Supabase authorization needs to remain enforced below future backend routes.

**How to apply:** Future protected routes should resolve role and vendor store ownership from authenticated identity and the database, never from a client-supplied store ID.

Protect vendor-controlled store fields and historical order snapshots with database triggers, not only route-level checks. Use `is_active` for catalog deactivation and block hard deletes of catalog or historical order records.

**Why:** RLS policies can permit a broad admin update path and future callers can bypass application assumptions; immutable historical meaning and commission governance need database enforcement.

**How to apply:** Any future migration that adds editable store or order fields should explicitly classify them as vendor-editable, admin-controlled, or immutable historical data.