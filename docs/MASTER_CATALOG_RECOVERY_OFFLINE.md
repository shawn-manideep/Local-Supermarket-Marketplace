# Master Catalog recovery: offline foundation

This is not a live recovery command. The module has no CLI, credentials,
environment access, database driver import, source connection or file writer.
`rehearseRecovery` accepts only a dedicated client to a disposable PostgreSQL
Unix socket under `/tmp/alb-catalog-rehearsal-*`, database
`alb_catalog_rehearsal`, user `alb_rehearsal`. Server identity is checked again
inside the transaction. Do not remove these restrictions to perform live work.

## Implemented

- Fixed B-to-A package descriptors; exact 63/687 counts.
- Explicit columns, duplicate IDs, category references, nullable values,
  active/archive states and bounded-format microsecond UTC timestamps.
- Detached package snapshots and deterministic SHA-256 integrity validation.
- Insert-only transaction, advisory and table locks, bounded timeouts,
  destination-empty checks, full typed row comparisons before commit.
- No retries. Lost COMMIT acknowledgement is `UNKNOWN_COMMIT_OUTCOME` regardless
  of whether the server committed. Close the client and independently verify
  destination contents before any further decision.
- All internal database failures are sanitized; cleanup cannot hide the original
  error. A successful commit followed by cleanup failure is separately reported.
- Real local PostgreSQL tests using the repository's actual relevant DDL and
  trigger definitions, with fixture schemas and no Supabase connections.

Run only the offline suite:

    node --test scripts/src/master-catalog-recovery.test.mjs

The test expects the existing PostgreSQL 17.6 Nix installation and existing
`pg` dependency in lib/db. It creates and removes only a disposable local cluster,
with TCP disabled and an explicit environment that excludes connection defaults.

## Deliberate limits

Package SHA-256 is corruption detection, not a signature or proof of source.
Fixed project descriptors do not establish live database identity.
No live extraction, identity/TLS connector, encryption or backup mechanism exists
in this implementation. There is no live apply switch.

JSONB is compared as typed semantic content, not original lexical key order.
The offline serializer refuses fractional/unsafe numeric JSON values rather than
risk precision loss. A future extractor must inspect actual JSONB numeric values
and either establish lossless compatibility or use a lossless representation.
No actual catalog rows have been inspected for this purpose.

This suite does not claim to reproduce Supabase roles, Auth, RLS, permissions,
all schema objects or platform behavior. It tests relevant table constraints and
triggers without changing live objects. No tests require full Supabase migrations.
A future live preflight must check actual columns, constraints, triggers, role
capabilities, identity and TLS before permitting any write.

Do not use the historical seed runner. Do not modify ledger entries 27/28, rerun
migrations, disable triggers or treat data recovery as migration repair.
Do not import master_mapping_audit or any business/account/storage records.

## Gates before source extraction or live recovery

1. Separately approve backup planning/tooling. Both projects require encrypted
   logical backups with tested restoration and a protected key separate from the
   backup. Cover application records, Auth data, migration histories/bootstrap
   markers and supported role/customization metadata. Record external Auth
   settings separately. Database dumps do not back up Storage file bytes:
   inventory and back up those separately under explicit approval.
2. Establish owner-controlled encrypted offsite retention and access controls;
   never put plaintext backups or keys in Git, deploy bundles, logs or chat.
   Do not assume Free-plan automatic backups/PITR or verified restoration exists.
3. Resolve or explicitly accept the provenance risk of ledger entries 27/28
   without editing them or weakening the migration runner.
4. Separately approve and implement a fixed-source, read-only, verified-TLS
   extraction connector, repeatable-read snapshot and encrypted package writer.
   Preserve timestamps without JavaScript Date conversion. Validate current
   counts/schema/relationships and source provenance. Stop on changed counts.
5. Rehearse the approved package only after export authorization, with encrypted
   handling and no real account/storage contents in test logs.
6. Separately approve a guarded A-only destination connector and maintenance
   window. Freeze catalog changes, recheck emptiness, schema and source package
   integrity. Do not automatically convert this offline entry point to live use.

Before COMMIT, failure rolls back. After COMMIT, hard-delete triggers prevent
assuming DELETE rollback. Freeze affected workflows and propose a reviewed
forward correction; updates may alter updated_at. Full database restore could
erase subsequent business data. Image strings are preserved, but reachability
and bytes are not recovered. Ordinary application listings are never auto-mapped.
