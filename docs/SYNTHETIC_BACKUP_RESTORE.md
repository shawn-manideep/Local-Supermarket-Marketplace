# Offline synthetic backup and restore rehearsal

This is NOT a Supabase backup tool. It cannot select a real project, accept a
connection string or restore to an external database. No CLI or live mode exists.
The existing Master Catalog recovery files and all application files are separate.

## Run

    node --test scripts/src/synthetic-backup.test.mjs

Requirements already present: Node.js built-in crypto, existing lib/db pg
dependency, PostgreSQL 17.6 at the explicit Nix tool path used by the module.
No new dependencies or credentials are needed.

## Architecture

1. Check at least 256 MiB of available local disk; create a private temporary
   cluster under /tmp/alb-synthetic-backup-* with TCP disabled.
2. Create only synthetic_backup_source and synthetic_backup_restore, seed fixed
   synthetic Auth-like, application and Storage-metadata-like tables.
3. Capture pg_dump custom-format output through a pipe into bounded RAM.
4. Encrypt archive and synthetic file bytes as separate AES-256-GCM components.
5. Encrypt a manifest with inventory, plaintext/ciphertext SHA-256 hashes, source
   fixture identity, timestamp, row counts, comparison snapshot and tool versions.
6. Authenticate the complete manifest and every component before returning any
   plaintext to the restore consumer. Restore from RAM through pg_restore stdin.
7. Compare records, UUID/FK values, constraints, indexes, enums, functions,
   triggers, RLS/policies, sequence state, microsecond timestamps and JSONB numeric
   precision. Comparison snapshots use PostgreSQL JSONB text, not JS numeric values.
8. Close clients, stop the local cluster and remove its directory.

Cluster handles are registered privately; arbitrary lookalike handles are refused.
Every client and restore target is validated as a fixed local Unix-socket
database/user. Server address must be NULL and current database/user must match.
Tools receive only static safe environment settings, with credential files
redirected to /dev/null. No parent environment values are read.

## Encryption and key custody

Each capture generates a random 32-byte key in memory, returned separately from
the encrypted package. It is never written to disk or put in child arguments.
Every component, including the manifest, gets a fresh random 12-byte nonce and
16-byte GCM tag. Reused nonces are refused. AAD binds format version, backup-set
ID, component name and ordinal.

Component inventory is fixed and ordered: database, synthetic-files, then the
encrypted manifest. Missing, duplicated, reordered or substituted parts fail
closed. Incomplete capture is not a valid package. Hashes authenticate against
the encrypted manifest; they are not a substitute for GCM or completeness checks.

Decipher.update bytes stay private until final tag verification succeeds. Failed
or unconsumed plaintext buffers are zeroed where controllable; every successful
consumer must zero returned buffers and key after use. JavaScript/OS memory
erasure is best effort, not a guarantee against heap snapshots or swap.

## Failure handling and limitations

- 32 MiB maximum per component/tool stdout; a bounded in-memory synthetic design,
  not streaming production backups. No plaintext archive file or protected
  temporary-storage assumption is used.
- PostgreSQL fixture database files are ordinary disposable local files containing
  SYNTHETIC data only. No real account, private-file or project records are used.
- Initial disk capacity is checked. Low-space tests inject byte counts into the
  budget checker; they do not fill a disk. Mid-run tool errors stop the workflow.
- Tool timeout: 30 seconds; client query timeout: 10 seconds. Raw tool stderr and
  underlying errors are not logged. Never automatically retry a restore attempt;
  failures may be ambiguous. Dispose of the sandbox instead.
- Restore uses exit-on-error and one transaction. Target must be empty. There is
  no clean/drop-overwrite production mode.
- Cleanup stops the cluster before removing its files. A stop failure is reported;
  do not delete a potentially running cluster's data directory.
- Tests cover actual pg_dump/pg_restore, synthetic encryption faults and local
  cleanup. They do not prove Supabase managed roles, Auth service compatibility,
  real Storage byte coverage, platform settings or full-project restorability.
- No persistent package format, owner key escrow, encrypted offsite copy, real
  extraction connector, backup scheduler or live restoration exists.
- No repository migrations, live ledgers (including entries 27/28), RLS, roles,
  environment values, providers or application behavior are altered.

Before real backup work: obtain separate owner approval for secure storage/key
custody, supported Auth and Storage coverage, verified-TLS source connectors,
encrypted persistent packaging, consistency coordination and isolated Supabase
restore acceptance. Do not remove the synthetic restrictions to enable live use.
