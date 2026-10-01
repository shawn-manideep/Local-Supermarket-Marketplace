---
name: Supabase migration history
description: Choosing the migration runner for the existing remote development database.
---

Use the database's established Supabase migration history when applying reviewed
forward-only SQL to the existing remote development project. Do not assume an
empty Drizzle journal means an empty database.

**Why:** The existing schema and migrations were already recorded by Supabase,
while the separate Drizzle history was empty. Running the full Drizzle journal
attempted to replay already-applied schema creation rather than only the new
migration.

**How to apply:** Inspect both histories before selecting a runner. Match the
target connection with read-only counts/fingerprints, apply only the new reviewed
SQL through the established history, and verify preservation afterward. Do not
rewrite old migrations or invent a retroactive Drizzle baseline without an
explicitly reviewed reconciliation.