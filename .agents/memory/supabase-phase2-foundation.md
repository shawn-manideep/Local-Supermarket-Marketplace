---
name: Supabase Phase 2 foundation
description: Runtime and migration boundaries for the Supabase-backed database and authentication foundation.
---

Keep Supabase database access lazy and require `SUPABASE_DB_URL` only when a database operation runs. Keep the health endpoint and static checks usable without Supabase credentials. Store RLS helpers, Auth profile creation, and database security triggers in the reviewable migration SQL alongside the Drizzle-generated schema.

**Why:** Phase 2 must be implementable and verifiable without inventing credentials, while Supabase authorization needs to remain enforced below future backend routes.

**How to apply:** Future protected routes should resolve role and vendor store ownership from authenticated identity and the database, never from a client-supplied store ID.