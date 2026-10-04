---
name: Isolated PostgreSQL testing
description: Avoid inheriting managed database defaults in disposable local database tests.
---

Disposable local PostgreSQL tests must explicitly choose the cluster's database
user and connection options instead of inheriting workspace database defaults.
Never use the managed development database as an implicit test fallback.

**Why:** This environment can supply managed PostgreSQL connection defaults
even when the normal shell username is absent. A local cluster initializes
under a different database user, so an otherwise local connection can fail
with a misleading missing-role error.

**How to apply:** Bootstrap and connect with the same explicit test-only user,
host, port, database, and SSL setting. Fail clearly when local prerequisites
are unavailable; do not silently skip or redirect inventory concurrency tests.

Full migration replay must use the target database's PostgreSQL major version,
not merely whichever binaries are first on PATH.

**Why:** The workspace's default binaries were PostgreSQL 16 while development
Supabase was PostgreSQL 17. A complete replay failed on the PostgreSQL 17 MAINTAIN
privilege even though the narrower integration suites passed. The Supabase-style
bootstrap also needed the postgres role for default-privilege statements.

**How to apply:** Check the target and local versions before full replay. Use
matching installed binaries and bootstrap only required local roles; never
rewrite approved migrations or use the managed database as a test fallback.