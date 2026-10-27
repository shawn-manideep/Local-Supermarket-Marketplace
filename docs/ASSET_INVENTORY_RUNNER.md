# Isolated asset inventory runner — synthetic preparation only

## Release boundary

No live database or storage reader is implemented or authorized. No inventory
module is imported by the application, provider selection or deployment startup.
The existing sidecar default and external-GCS adapter are unchanged.

The only mintable execution capabilities contain structured-cloned, in-memory
fixtures. Synthetic authorization is opaque, single-use, expiring and bound to
the exact validated policy and session. It is not a live approval token.
There is no environment variable, command-line flag or policy property that
activates live access. The future database/listing interfaces do not confer IAM
privileges or constitute a sandbox for arbitrary third-party adapter code.

## Commands

Focused checks, including the actual CLI in isolated child processes:

```sh
pnpm --filter @workspace/api run test:inventory
pnpm --filter @workspace/api run test:external-gcs
pnpm --filter @workspace/api run typecheck
```

Offline policy validation from the repository root:

```sh
node --import tsx backend/api/src/inventory/entry.ts --mode=validate-policy-only < approved-policy.json
```

The file in that example is an operator-supplied policy, not a credential file
and not a file created by this preparation. Input is JSON on stdin only, limited
to 16 KiB and one second. Only the exact mode argument is accepted. Output is
aggregate JSON on stdout; invalid input exits nonzero without reflecting input.

The same invocation with `--mode=metadata-only` validates policy and then
returns `LIVE_EXECUTION_UNAVAILABLE`, exit 1. Invalid policies fail earlier.
It never creates clients, reads environment configuration or credentials, or
contacts any service. Successful validation means syntax/scope validation only,
not approval or proof of actual project identity, permissions or connectivity.

## Exact policy shape

```json
{
  "version": 1,
  "target": "original-apna-local-basket",
  "history": "current-objects-and-retained-document-rows",
  "namespaces": [
    "product-images",
    "application-branding",
    "vendor-documents",
    "delivery-photos"
  ],
  "limits": {
    "pageSize": 200,
    "maxDbRows": 10000,
    "maxObjects": 10000,
    "maxDbRequests": 60,
    "maxStorageRequests": 55,
    "requestTimeoutMs": 5000,
    "maxDurationMs": 180000,
    "maxDbDurationMs": 60000
  }
}
```

The target is a logical allowlist label, not a live project/bucket identifier.
There are no operator-supplied service endpoints or storage roots. Synthetic
roots are fixed to invented fixture namespaces. Unknown fields, executable
properties, other targets/scopes/namespaces, and limits above caps fail closed.
Namespace order is fixed. Limits may be reduced to positive integers.

## Narrow reader contracts

`contracts.ts` freezes the exact table/column projections from the reviewed plan:
products, Master products, stores, Vendor documents and pickup photos.
No general SQL, Auth/customer/contact data, bank details, or document filenames
are exposed. Returned rows with unexpected columns are rejected.

The storage interface has only namespace-scoped, manually paginated metadata
listing. It has no file download, signed URL, mutation, copy or IAM operation.
Returned metadata is field-allowlisted and checked against the bound namespace.
Real readers must eventually translate physical source keys into the exact
logical legacy reference mapping; no live translation is claimed by fixtures.

All five table scans include inactive/current/historical rows supplied by the
approved projection. Only null listing images use the current Master fallback;
empty strings do not. Master images and store logos remain separate counters.
The active branding object is an implicit storage reference, not a DB column.
Retained document versions are included; deleted/replaced photo/logo history is
not recovered. Noncurrent object generations are outside this policy.

## Scan behavior and privacy

Requests are bounded by the remaining row/object and request budgets, page cap,
per-request timeout, whole-run deadline, database-phase deadline and grant expiry.
Repeated cursors, unexpected namespaces/columns and malformed metadata fail
closed. Timeouts signal cancellation. Limits exhausted before all namespaces
finish yield incomplete results, not truncated success.

All error paths are fixed categories, never SDK errors or input values. Reports
are immutable, registered internal aggregates; serialization refuses arbitrary
unregistered report objects. Raw identifiers, paths, URLs, checksums, filenames
and metadata stay out of reports. Inventory modules use no logger.

The fixture launcher strips inherited environment variables and blocks all
network connections (including loopback), fetch, common DNS/HTTP transports, and
conventional credential-file reads. Its file guard permits module loading and
is defense-in-depth, not an operating-system sandbox.

`synthetic-complete` means the bounded fixture scan finished, NOT that live
assets are verified or ready for migration. Missing/unreferenced counts are
candidates; they never cause deletion. Shared references are not collisions.
Distinct source names mapping to one key are counted as mapping collisions.
Changed generations/metagenerations, provider change flags or timestamps during
the scan are counted as concurrent changes. No cross-service atomic snapshot is
claimed. A complete scan can contain anomalies and concurrency warnings.

The runner does not download content, validate file signatures, independently
recompute byte checksums, recover deleted history, change references, copy
objects, or activate a provider. Maps are local to one scan; no raw checkpoints
or manifests are persisted. Process exit is the cleanup boundary; JavaScript
does not guarantee secure memory zeroization.

## Remaining live-access gates

Before any future live implementation/execution, separately approve:

1. An original-project, restricted database metadata reader, including private
   table visibility. Ordinary client RLS is incomplete; no service-role fallback.
   Any roles, grants or privileged projections need their own approval.
2. An original-project storage listing context. Do not assume an independent
   identity can access Replit-managed storage or that sidecar listing is allowed.
   Prefer `storage.objects.list`; `storage.objects.get` also permits bytes.
3. A real approval verifier bound to authenticated owner approval, exact policy,
   original service identities, roots, scope, expiry and single execution.
   Synthetic grants must never be repurposed into live grants.
4. A reviewed live transport with read-only SQL transactions, TLS/target checks,
   connection/statement/lock/idle timeouts, cancellation/rollback/closure,
   no automatic retries, and accounting for every preflight/recheck request.
   The current in-memory contracts do not implement these service protections.
5. Namespace/history scope, request budget and aggregate-report retention.

Stop if metadata-only access cannot be safely enforced; broader credentials
require explicit approval. Actual inventory approval remains separate from
migration, cloud provisioning, IAM changes, provider activation, API deployment,
EAS updates or APK building.

## Verification results

- Inventory synthetic checks: **21 passed**, zero failures or skips.
- Existing storage/configuration compatibility checks: **28 passed**.
- API TypeScript check: passed.
- Working-tree whitespace check: passed.

Inventory checks ran with an empty inherited environment and the no-I/O guard.
They include real CLI child-process validation/refusal checks using invented
environment markers, not actual credentials. They cover bounded input, grant
binding/expiry/replay, inaccessible byte/admin operations, namespace and column
rejection, budgets, timeouts, concurrency, redaction and source immutability.

The broader application suite was not rerun. Its previously documented ten
failures and four skipped live-auth checks remain unresolved release gates.
No live database, storage, external URL, credential or cloud resource was
accessed by this preparation. No actual inventory, API startup/deployment,
provider activation, EAS update or APK build was performed.

## Changed-file manifest

- `backend/api/package.json` — focused test command only.
- `backend/api/scripts/inventory-no-io-guard.mjs` — synthetic verification guard.
- `backend/api/scripts/run-inventory-fixtures.mjs` — environment-free test launcher.
- `backend/api/src/inventory/contracts.ts` — projections, metadata interfaces and caps.
- `backend/api/src/inventory/policy.ts` — offline strict policy validation.
- `backend/api/src/inventory/report.ts` — immutable aggregate-only serialization.
- `backend/api/src/inventory/synthetic.ts` — fake readers and fixture-only grants.
- `backend/api/src/inventory/reconcile.ts` — reference and metadata classification.
- `backend/api/src/inventory/runner.ts` — bounded scan and safe failure handling.
- `backend/api/src/inventory/cli.ts` — bounded offline command handling.
- `backend/api/src/inventory/entry.ts` — command bootstrap and safe output.
- `backend/api/src/inventory/inventory.test.ts` — synthetic negative/positive checks.
- `docs/ASSET_INVENTORY_RUNNER.md` — usage, limitations and approval gates.
