# External GCS compatibility preparation

## Release state

This is dormant implementation preparation, not migration or runtime approval.
The unset provider remains the existing Replit GCS sidecar. Existing App Storage
selection is unchanged. No environment, EAS, database record, storage object,
IAM policy, workflow, or deployment is modified by this preparation.

External GCS requires an explicit provider selection, all configuration checks,
and a separate runtime-approval marker. The marker is a configuration safeguard,
not proof of actual approval, permissions, bucket privacy, or migrated data.
Do not set it or start the API-only entrypoint during local preparation.
The API-only entrypoint still performs a database identity query when started.

## Small storage interface and compatibility

`ObjectStore` exposes metadata lookup, generation-pinned byte reads,
generation-conditional writes, and generation-conditional deletion. API routes
continue to own authorization and input validation. Existing Replit adapters
are not refactored or replaced; the new interface is used by the external path.

The destination bucket is selected only by its dedicated configuration. An old
reference cannot select a bucket. The **entire normalized legacy reference**
becomes a key inside that destination bucket, including a legacy bucket-like
first segment. No bucket-prefix stripping or guessed path conversion occurs.

- Product keys retain the public reference root, store identifier and image ID.
- Documents and photos retain their private root and distinct area namespaces.
- Branding retains the public root and active-logo key.
- Leading legacy reference slashes are normalized; traversal, escaped paths,
  extra private path segments and cross-area references are rejected.
- The configured legacy roots must match the existing reference-producing
  settings exactly and must not overlap.

This mapping is fixture-verified only. It does not establish that every existing
record matches these formats. A separately approved inventory must establish
compatibility before any runtime activation. Do not rewrite database references
or reinterpret arbitrary URLs to make a reference fit.

## MIME, metadata, revision and failures

Writes preserve MIME, cache controls and custom metadata. Private data retains
private/no-store semantics; route response headers remain unchanged. Product
images and branding remain API-mediated; there are no new signed or public URLs.

New product/document/photo objects use create-only writes. Branding reads the
current generation then conditionally replaces that exact version. Concurrent
replacements fail rather than silently overwrite an intervening update.
Reads pin bytes to the metadata generation; checksum validation is delegated
to the GCS SDK. Cleanup deletion also requires the observed generation.

GCS generates new generations at the destination. Source generation values
cannot be assigned to destination objects. Preserve source identity/checksum
in a migration manifest; expect the branding revision to change at cutover.

The production client uses explicit server credentials, the Google storage
endpoint and no automatic retries. It does not fall back to ADC or sidecar
credentials; an emulator endpoint override is refused. SDK exceptions are
replaced by redacted not-found/conflict/unavailable errors.

A network error after a committed write can have an ambiguous outcome. Do not
retry or report a successful migration automatically; reconcile using
generations/checksums. Cloud storage and database changes are not one atomic
transaction. Existing route compensation remains in place.

## Required configuration names — do not configure yet

| Name | Purpose |
| --- | --- |
| `API_OBJECT_STORAGE_PROVIDER` | Explicit provider selection |
| `EXTERNAL_GCS_RUNTIME_APPROVAL` | Separate activation safeguard |
| `EXTERNAL_GCS_PROJECT_ID` | Owner-controlled Google project |
| `EXTERNAL_GCS_BUCKET` | Explicit private destination bucket |
| `EXTERNAL_GCS_CLIENT_EMAIL` | Server-only service identity |
| `EXTERNAL_GCS_PRIVATE_KEY` | Server-only PEM credential, held in Secrets |
| `EXTERNAL_GCS_PRIVATE_REFERENCE_ROOT` | Inventory-approved legacy private root |
| `EXTERNAL_GCS_PUBLIC_REFERENCE_ROOT` | Inventory-approved legacy public root |
| `PRIVATE_OBJECT_DIR` | Must match the approved private reference root |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Must match the single approved public root |

The existing API-only Supabase target profile, signing-secret and TLS
requirements still apply unchanged. No database credential or storage
credential belongs in Expo public variables. Credential shape checks are not
cryptographic verification, IAM verification or readiness checks.

## Local verification

Run from the repository root:

```sh
pnpm --filter @workspace/api run test:external-gcs
pnpm --filter @workspace/api run test:external-gcs-routes
pnpm --filter @workspace/api run test:storage-regression
pnpm --filter @workspace/api run rehearse:external-gcs
pnpm --filter @workspace/api run typecheck
```

The four storage scripts use a fixed runner that does not inherit application
secrets, database URLs, credentials, proxy settings or provider configuration.
Non-loopback Node connections are blocked. Route checks create disposable
PostgreSQL clusters under the temporary directory and simulate Supabase Auth;
they never contact a real Supabase project. The route mode injects only the
in-memory GCS byte adapter, not a live provider.

The rehearsal constructs both source and destination in memory. It accepts no
live source, bucket, endpoint, credentials, database or filesystem input. The
direct CLI accepts only its synthetic-only flag. The report includes counts,
asset categories, SHA-256 verification, metadata verification and whether the
synthetic source stayed unchanged; it contains no object names, bytes,
credentials, checksums or database references. Fault-injection tests prove that
byte and MIME corruption fail verification.

## Future migration and rollback gates

1. Approve owner account, private bucket region, cost limit, least-privilege
   runtime/migration identities, retention and the reference inventory scope.
2. Separately authorize inventory and reads of referenced current/historical
   assets. Verify all mappings and metadata; do not assume the fixtures prove
   live compatibility.
3. Separately authorize destination provisioning, private-access controls and
   copying from the original project's authorized context. Never export Replit
   sidecar credentials. Copy without deleting source objects and verify every
   byte checksum and required metadata using a redacted manifest.
4. Approve a brief storage-write pause, final reconciliation and a coordinated
   switch of the original portal API and separate API to one target. A one-off
   copy while portal uploads keep writing solely to old storage becomes stale.
5. Verify live role/ownership denials, images, branding, document responses,
   delivery photo state and failure behavior before approving APK preparation.

Before destination writes start, rollback means keeping the original source
active. After new writes, pause storage writes and reverse-reconcile new
objects/replacements using a retained journal before switching back. This needs
separate approval and verification; do not claim one-click rollback, restore
the whole database, or delete either store during this preparation.

Live IAM/privacy, credentials, network connectivity, file inventory, costs,
crash-recovery behavior and cross-project operation remain unverified. The
synthetic script is deliberately **not** a production migration utility.

## Verification results

- Focused configuration/storage/branding checks: 28 passing tests.
- GCS-backed route checks: 52 passing tests, including published/unpublished
  images, Vendor upload ownership and failed writes, private documents,
  Admin access, Delivery Partner assignment access, and private headers.
- Synthetic rehearsal: all four asset classes verified, no SHA-256 or metadata
  failures, source unchanged.
- API TypeScript check: passed.
- Existing development API restarted successfully; API liveness returned OK.
  No asset/private-file request or API-only database startup was used.
- Broad API regression: 451 tests, 437 passing, 10 failing, 4 skipped live-Auth
  tests. All 10 failures were reproduced against unchanged repository source
  in a temporary baseline directory under the same isolated conditions.
  No new failure names appeared.

The full suite is **not green**. Existing failures are in:

- `src/catalog-management/routes.test.ts`: one authorization/status expectation.
- `src/customer-saved/saved-settings-images.integration.test.ts`: five catalog/
  image checks currently rejected by the existing compliance gate.
- `src/master-catalog/excel-workbook.test.ts`: two workbook expectations.
- `src/orders/vendor-management.test.ts`: two source-structure assertions.

Those unrelated application behaviors/tests were not changed to hide failures.
The fixture-network guard remained enabled for both current and baseline tests.

## Complete changed-file manifest

Runtime preparation:

- `backend/api/src/storage/object-store.ts`
- `backend/api/src/storage/external-gcs-config.ts`
- `backend/api/src/storage/external-gcs.ts`
- `backend/api/src/storage/external-assets.ts`
- `backend/api/src/storage/provider.ts`
- `backend/api/src/product-images/storage.ts`
- `backend/api/src/vendor-documents/storage.ts`
- `backend/api/src/branding/storage.ts`
- `backend/api/src/api-only/target-guard.ts`

Local fixtures, tests and commands:

- `backend/api/src/storage/fixtures/fake-gcs.ts`
- `backend/api/src/storage/external-gcs.test.ts`
- `backend/api/src/storage/synthetic-rehearsal.ts`
- `backend/api/src/storage/rehearsal-cli.ts`
- `backend/api/src/api-only/target-guard.test.ts`
- `backend/api/src/vendor-documents/vendor-documents.integration.test.ts`
- `backend/api/src/orders/consolidated-enhancements.integration.test.ts`
- `backend/api/scripts/fixture-network-guard.mjs`
- `backend/api/scripts/run-storage-fixtures.mjs`
- `backend/api/package.json`

Documentation and project decision notes:

- `docs/EXTERNAL_GCS_PREPARATION.md`
- `docs/API_ONLY_REPL_DEPLOYMENT.md`
- `.agents/memory/MEMORY.md`
- `.agents/memory/replit-deployment-isolation.md`
- `.agents/memory/external-storage-direction.md`
