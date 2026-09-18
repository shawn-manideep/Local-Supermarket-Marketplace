---
name: Migration repair discipline
description: How to preserve approved database history when later security reviews find defects.
---

Approved migrations are normally immutable. Any later RLS, trigger, privilege,
ownership, or index repair must be introduced in the next ordered forward-only
migration.

The narrow exception is a migration proven never to have applied in the target
history, where its first execution fails and the user explicitly authorizes a
minimal correction before any successful application. Preserve its intended
model and change only what makes that original definition valid.

**Why:** Editing a migration that may already have run does not update existing
databases and creates different schemas for fresh and existing environments.

**How to apply:** Keep approved migration files unchanged after any successful
application. Add idempotent forward repairs with explicit policy/trigger
replacement and register the new migration in the journal. Use the exception
only after confirming empty/absent remote history and obtaining explicit user
authorization.