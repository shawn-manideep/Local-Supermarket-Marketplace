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