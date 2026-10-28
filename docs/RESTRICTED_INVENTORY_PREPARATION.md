# Restricted inventory components — offline implementation only

## Current release boundary

The original Supabase project and current storage remain unchanged. No live
transport, credential loader, database query, Google client, journal persistence
backend or live writer pause is installed here. The CLI remains synthetic-only
and refuses live metadata execution. New components are not imported by the
application, existing storage provider or API-only startup.

This preparation supplements `ASSET_INVENTORY_RUNNER.md` and
`SHARED_STORAGE_OFFLINE_SAFEGUARDS.md`. Their earlier result counts describe earlier
focused runs, not the new preparation test suite.

## Restricted database and metadata ports

`inventory/restricted-readers.ts` wraps two pre-bound transport contracts:

- Database pages receive only an allowlisted table, its frozen exact projection,
  an internally managed cursor, the remaining page/row limit and an AbortSignal.
  Callers cannot submit SQL, column names, endpoints or credentials.
- Storage pages receive only one of the four reviewed namespaces, an internally
  managed cursor, the remaining page/object limit and an AbortSignal. There is
  no bucket parameter, byte reader, URL fetcher, signed URL or mutation method.
- Logical reference roots are snapshotted, disjoint and traversal-free. They do
  not select physical buckets. Actual legacy-to-physical translation remains a
  separately reviewed live transport responsibility.

The wrappers validate exact page schemas, row projections and object namespaces
before returning detached data. Extra columns, accessors, malformed metadata,
oversized pages, repeated cursors and invalid selectors fail closed. Limits and
deadlines come from the existing validated policy; request counts also bound
page counts. Counters include attempted requests; there is no automatic retry.
Parallel requests are refused, preventing shared-budget races. Exhaustion,
failure, cancellation or premature traversal termination remain `INCOMPLETE`.

`TRAVERSAL_COMPLETE` means every allowlisted table and namespace returned its
terminal page. It does not mean references match, private IAM is correct or bytes
have been checked. The existing reconciliation runner/report still performs
reference classification and anomaly checks. The new wrappers are intentionally
not accepted through the existing synthetic-grant path or exposed as live CLI
options. Future live composition and authenticated approval verification require
separate implementation and review.

Transport callback injection is not a sandbox: these are trusted adapter ports,
not executable code supplied by an inventory operator. Approved real adapters
must enforce pagination truthfully; no wrapper can detect a provider that
silently omits items while falsely claiming a terminal page.

## Cancellation and cleanup

On deadline, explicit close, invalid data, concurrent access or other failure,
the wrapper aborts active work, invokes `cancelAndClose` once and permanently
poisons the session. Closing before dispatch prevents a transport call. No late
response can reactivate it.

Cleanup acknowledgement is awaited for at most 100ms and never intentionally
extends the overall deadline. An acknowledgement failure/hang is exposed as
`cancellationConfirmed: false`; the result stays incomplete and the ports cannot
be reused. Mock tests prove signal propagation, cleanup calls, bounded waits and
closed-session refusal, including an uncooperative transport.

Resolving `cancelAndClose` is only an adapter assertion. Before live use, prove
driver cancellation, rollback, query settlement, connection release/discard and
HTTP request termination. JavaScript cannot forcibly stop arbitrary callbacks,
synchronous work, ignored signals or a remote query. Server-side timeouts and a
reviewed process isolation/termination strategy are still needed. Do not claim
real service cancellation has been verified by these tests.

## Protected journal contract and recovery model

`inventory/protected-journal.ts` defines a pre-bound, owner/run-scoped persistence
interface: bounded page reads, atomic expected-sequence append and close.
`DURABLE` must mean an encrypted, access-restricted event has been committed and
flushed before any corresponding object mutation. The interface does not provide
that persistence, encryption, access control or distributed consistency.

The pure replay model bounds records to 10,000, deduplicates identical sequence
replays and rejects conflicting duplicates, skipped sequence numbers, invalid
transitions and unexpected fields. Records contain opaque operation handles,
attempts, expected/observed generations and verification state. They bind to the
protected detailed manifest described in `SHARED_STORAGE_OFFLINE_SAFEGUARDS.md`.
Do not put either protected record stream or manifest in reports or logs.

An intent recovered after a crash or lost response remains unresolved. UNKNOWN
does not authorize retry. Only verified NOT_COMMITTED enables a new attempt.
COMMITTED operations cannot be retried; conflicting generations require review.
Successful replacement evidence requires a different observed generation;
deletion commit evidence requires verified absence. A boolean flag is not proof:
a future approved reconciliation verifier must establish the evidence.

Synthetic replay/recovery tests cover duplicate intents, conflicting events,
ambiguous outcomes, retries, generation changes, committed deletion/replacement
and a mocked durable append whose acknowledgement is lost. Reports expose only
counts and fixed flags; there is no automatic source-deletion action.
These tests do not prove actual durability, encryption, IAM or crash-safe storage.

## Writer-coordination gate

`inventory/writer-coordination.ts` evaluates a bounded declared instance roster
for both marketplace and separate APIs. Every declared instance must acknowledge
the same fresh pause epoch for every listed asset workflow:

- Product uploads and compensation.
- Vendor document uploads/replacements and compensation.
- Admin branding replacement.
- Delivery photo uploads/replacements, prior-photo cleanup and compensation.
- Migration tools and background retries.

Acknowledgements require paused=true, zero active work and zero queued work.
Missing, duplicate, stale, mismatched or unknown acknowledgements block. Extra
API instances require their own full acknowledgements. Output is aggregate only;
success is explicitly labelled `SYNTHETIC_GATE_SATISFIED`.

This does not pause a live writer or mint a cutover permission. A future
authenticated coordinator must discover a complete authoritative deployment
roster (including old releases/workers/external tools), enforce pause leases,
prevent newly joining instances and renewed writes, drain DB/object/cleanup work,
and revalidate under a fenced cutover lease. The pure gate cannot prove a roster
is complete, an acknowledgement is truthful or a writer remains paused afterward.
Unexpected writers must extend the reviewed registry before cutover is permitted.

## Separate permissions and runtime approval required

1. **Database reader:** a specifically approved original-project identity with
   SELECT on the fixed projections of five reviewed tables (prefer restricted
   views/column grants); sufficient visibility of retained/private asset
   references without customer/contact/bank/Auth data. No service-role fallback,
   unrestricted SQL, writes or migration grants. Roles/grants are not created now.
2. **Database transport:** verified original target, TLS certificate validation,
   bounded connect/statement/lock/idle timeouts, read-only transactions,
   deterministic keyset pagination, cancellation, rollback/release/discard and
   complete request accounting including preflight/identity checks. Existing row
   contracts alone do not implement or authorize those controls.
3. **Storage reader:** an approved original-source listing context restricted to
   reviewed namespaces and required metadata fields. Prefer metadata listing-only
   access; object-get can also permit byte downloads and requires broader explicit
   approval if unavoidable. Do not export sidecar credentials or assume a new
   service identity can list Replit-managed assets. Stop if safe source listing
   cannot be supported.
4. **Approval:** authenticated owner approval bound to target, identities,
   namespaces/roots, policy, expiry and one execution, with audit and revocation.
   Current synthetic grants must never authorize live readers.
5. **Journal runtime:** approved protected location, encryption/key custody,
   owner/run isolation, retention, atomic append, durability/flush, bounded reads,
   integrity protection and crash/resume tests. This needs separate provisioning
   and permission approval; no backend or resources have been created.
6. **Coordinator runtime:** authenticated instance discovery/attestation, fencing,
   enforced pause/drain hooks and lease recovery. Any production hooks or route
   changes require separate approval; none are implemented here.

Reader implementation approval is distinct from actual live inventory execution.
Inventory approval does not authorize byte reads/copying, IAM or billing changes,
bucket creation, provider activation, pause/cutover, deployment, EAS or an APK build.

## Final offline verification

| Command | Result |
| --- | --- |
| `pnpm --filter @workspace/api run test:inventory` | 53 passed, 0 failed, 0 skipped |
| `pnpm --filter @workspace/api run typecheck` | Exit 0 |

The inventory command runs both existing inventory tests (32) and new preparation
tests (21) under the existing empty-environment/no-I/O guard, including blocked
loopback and conventional credential-file reads. No live-auth checks were run.
The broader API and Customer suites were not rerun.

An initial typecheck caught a union-promise annotation in the new wrapper; it was
corrected. A later run exposed a timing assumption in an existing 1ms fixture:
expiry can safely occur before any request is dispatched. That test now permits
zero or one dispatch while still requiring TIMEOUT and incomplete status.
New active database/storage cancellation tests independently require actual
signal delivery, cleanup and terminal-session behavior; deadline enforcement was
not relaxed.
