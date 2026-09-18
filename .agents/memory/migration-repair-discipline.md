---
name: Migration repair discipline
description: How to preserve approved database history when later security reviews find defects.
---

Approved migrations are immutable. Any later RLS, trigger, privilege, ownership,
or index repair must be introduced in the next ordered forward-only migration.

**Why:** Editing a migration that may already have run does not update existing
databases and creates different schemas for fresh and existing environments.

**How to apply:** Keep approved migration files unchanged. Add idempotent
forward repairs with explicit policy/trigger replacement and register the new
migration in the journal.