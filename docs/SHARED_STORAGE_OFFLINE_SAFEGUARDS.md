# Shared storage safeguards — offline preparation only

## Release boundary

The existing marketplace, original Supabase target and all four portals are
unchanged. No live inventory reader, migration executor, durable journal,
writer-pause mechanism or provider cutover is implemented by this work.
No external bucket or cross-project storage capability is assumed.

The inventory modules remain outside application startup and accept synthetic
grants only. The CLI still refuses live metadata execution. Configuration markers
and synthetic grants are not owner approval or live permission verification.

## Tested inventory guarantees

- Exact column projections and four supported namespaces remain allowlisted.
  Extra/hidden/accessor properties and proxy records are rejected.
- Row/object/page-size/request ceilings remain those in `ASSET_INVENTORY_RUNNER.md`.
  A request is one page; request ceilings therefore also bound page counts.
  Oversized pages, extra page fields, repeated cursors and malformed data fail closed.
- Request, database-phase, overall and grant-expiry deadlines bound execution.
  Late results are checked after await, including synchronous work that delays
  timer callbacks. Abort signals are issued, but cannot force an arbitrary live
  driver to stop; real transport cancellation remains a separate implementation gate.
- Budget exhaustion, timeout and invalid schema produce `status: incomplete`,
  `complete: false` with fixed failure categories.
- Unsupported or external references, mapping collisions, concurrent changes,
  missing candidates and metadata mismatches now produce
  `RECONCILIATION_REQUIRED`, never completed reconciliation.
  External URLs are counted but never followed. Missing candidates do not prove
  loss and unreferenced candidates never authorize deletion.
- Aggregate serialization excludes identifiers, paths, URLs, filenames, checksum
  values, raw metadata and SDK error messages. Report registration independently
  refuses a completed scan with unresolved anomalies.
- A clean `synthetic-complete` result establishes fixture behavior only, not
  atomic consistency, live asset coverage or migration readiness.

Physical/logical key translation remains unverified. The active branding object
is implicit; retained document rows are included. Store logos and Master images
are separately classified, not blindly copied or fetched. Deleted history and
noncurrent object generations are outside the existing inventory scope.

## Protected journal design — not a persistence implementation

Use two distinct outputs:

1. Aggregate operator reports containing only fixed statuses and bounded counts.
2. An encrypted, access-restricted migration journal and manifest. Never put the
   detailed journal in Git, console logs, ordinary reports or public artifacts.
   Detailed keys/checksums needed for reconciliation stay inside this protected
   boundary, not inside the aggregate reporting interface.

Before implementation/execution approve journal ownership, location, access,
encryption/key custody, retention, backup and recovery. Do not reuse broad runtime
permissions as migration/journal permissions.

Each protected operation records: opaque run/operation identity; approved source
and destination binding; asset class and exact canonical mapping; source
generation/metageneration, size, MIME, cache/security metadata and checksum;
destination precondition and observed generation; intended action; timestamps;
outcome; content/metadata verification; and corresponding database-reference
reconciliation. Do not collect names, contact data, credentials or raw file bytes.
Do not print these records. Never copy a source generation as a destination
precondition: generations are provider-local observations.

State sequence:

`PLANNED -> INTENT_DURABLE -> ATTEMPTED -> OBSERVED -> VERIFIED -> RECONCILED`

An error, timeout or crash after intent/attempt means `UNKNOWN`, not proof that
the operation failed. Persist append-only, ordered events with integrity checks.
Persist intent before mutation and observations after it. If the journal cannot
durably record intent, do not mutate. If recording the outcome fails, stop and
reconcile the durable intent; do not repeat the operation blindly.

On resume, verify run binding and current state. For an upload/replacement,
compare generation, checksum and required metadata against the intended object.
An unchanged precondition can establish no commit only with adequate evidence;
an unexplained/new generation is a conflict, not permission to overwrite.
For a deletion, reconcile absence and retained versions where available; a
tombstone never automatically deletes the source. Database commit state must be
checked separately under approved access. Conflicting/insufficient evidence
requires owner review. New writes, replacements and cleanup deletions all need
journal coverage during the rollback window.

Retention/versioning must preserve overwritten branding and any source objects
that an approved reverse replacement could overwrite. Retained evidence is needed
before attempting those replacements. The prepared adapter does not supply this
durable journal, crash recovery, distributed locking or write interception.

## Coordinated writer-pause checklist — not a live operation

1. Identify every running API instance, old release, worker and retry source.
   Enumerate writers: product-image uploads and compensation; Vendor document
   upload/replacement/compensation; Admin branding replacement; Delivery Partner
   photo upload/replacement, prior-photo deletion and compensation; migration
   tools and any approved external writers.
2. Approve the maintenance window and operational effects: document submission
   and pickup flows can depend on asset writes. Preserve existing authorization.
3. Pause at a common enforced boundary across both APIs, not just UI buttons.
   Account for queued retries and background work; drain in-flight object writes,
   database transactions and cleanup. Obtain acknowledgements from every instance.
   If any writer cannot be quiesced, stop rather than claim a safe cutover.
4. Keep reads available where safely possible. Re-inventory/reconcile under the
   pause, including branding, retained documents and final photo replacements.
   Reconcile every unknown journal outcome and verify final content/metadata.
5. Configure both APIs for the same approved destination and identical reference
   roots. Check all instances; do not reopen writes while any old-source writer
   remains active. Restart/rollout control is a future approved operation.
6. Verify public publication rules, Vendor ownership/compliance, Admin access,
   assigned Partner photo access and private response headers before reopening.
   Prove read/write consistency from both APIs and all four portals under approval.
7. Reopen writers together only after acceptance; monitor and retain the journal
   for the approved rollback period. No ad-hoc dual-write mode is implemented.

## Recovery and rollback

Before destination writes, keep the source authoritative. After destination
writes, pause and drain both APIs, then reverse-reconcile journaled new objects,
replacements and deletion outcomes. Retain both stores; never restore the entire
database or blindly flip a provider setting.

Restore new objects with create-only preconditions. Restore replacements only
against the observed source generation, retaining prior content as approved.
Treat source changes as conflicts. Review deletion tombstones rather than
automatically deleting source objects. Reconcile current database references
against source availability before reopening writes. Refresh branding revision:
source/destination generations are not interchangeable.

Synthetic recovery tests exercise failures before commit and response loss after
committed uploads, replacements and deletions, single-attempt behavior, unchanged
forward source objects, reverse upload/replacement preconditions and branding
generation changes. They do not prove durable-journal recovery, real checksum
transport validation, IAM/privacy, rollback completeness or live consistency.

## Required separate approvals / remaining implementation

- Approve owner/project/region/budget, identities, private IAM and retention.
- Approve and implement restricted original-project live readers, exact key
  mapping, database TLS/read-only/cancellation guarantees and source listing
  capability. No service-role fallback or export of sidecar credentials.
- Approve actual bounded metadata inventory separately from reader implementation.
- Approve journal persistence, migration executor, quiescence enforcement and
  crash/resume tests before any object copying or provider activation.
- Separately approve provisioning/billing/IAM, byte reads/copies, live pause,
  coordinated cutover, separate API deployment and live authorization acceptance.
- Only then verify authenticated EAS metadata, authorize required settings and
  consider an APK build/device acceptance.

Previously verified Customer results: 100 pass, 0 fail, 0 skip. Previously verified
broader API results: 479 pass, 0 fail, 4 live-auth checks skipped. These are not
rerun or superseded by this focused storage preparation.

## Focused verification results

Run using installed dependencies, without inherited application credentials:

| Command | Final result |
| --- | --- |
| `pnpm --filter @workspace/api run test:inventory` | 32 passed, 0 failed, 0 skipped |
| `pnpm --filter @workspace/api run test:external-gcs` | 36 passed, 0 failed, 0 skipped |
| `pnpm --filter @workspace/api run typecheck` | Exit 0 |
| `git diff --check` | Passed |

Inventory verification uses the existing no-I/O fixture runner, blocking even
loopback and conventional credential-file reads. External-GCS unit verification
uses the existing isolated fixture runner, allowing local mock HTTP only and
blocking non-loopback network access. No live-auth tests were executed.

The first new recovery-test run exposed only a test snapshot representation
mismatch: `structuredClone` turns Buffers into Uint8Arrays. The snapshots now
compare complete serialized in-memory object state consistently; byte/content,
metadata and generation assertions remain in place. The final focused runs above
pass. No production adapter change was needed.
