# Cloudflare R2 preparation — inactive, offline-verified only

## Selection and boundaries

`cloudflare-r2` is an additional `API_OBJECT_STORAGE_PROVIDER`. The unset default
remains `replit-gcs-sidecar`; `disabled` remains effective. No runtime environment
or deployment configuration is changed by this implementation.

All four existing asset adapters are wired: product images, application branding,
Vendor documents and delivery photographs. Existing routes, bearer verification,
store/assignment ownership and Admin review remain authoritative. Mandatory Vendor
documents still reject replacement with `DOCUMENTS_PENDING_REVIEW` while SUBMITTED.
The pending Supabase asset provider and fallback behavior are preserved; simultaneous
R2 selection and a separate asset-provider override are deliberately rejected.

## Concurrency without database changes

The existing ObjectStore interface is unchanged. Existing database references remain
logical references, not raw R2 URLs or bucket selectors.

Each allowed logical key has:

- A hashed manifest key under the configured R2 prefix.
- A new UUID revision per mutation (including deletes).
- An immutable, create-only payload key containing that UUID.
- SHA-256 and byte length in the manifest.

Initial payload and manifest writes use `If-None-Match: *`. Replacement first
compares the application's expected UUID, then conditionally publishes the manifest
with `If-Match` on the observed ETag. The ETag is only a CAS token, never a GCS
generation. Manifest contents include the unique revision, preventing ordinary
same-content ABA. Reads retain the selected manifest snapshot and retrieve exactly
its immutable payload, verifying size, SHA-256 and accepted file signature.

Delete is a conditional **logical tombstone**, not physical erasure. Keys are never
reused, tombstones are permanent, and payloads are retained. No DeleteObject,
listing, multipart, copying, unconditional overwrite, mutation retry or automatic
cleanup is implemented. Losing a response may mean a write committed; the adapter
reports UNKNOWN_OUTCOME and leaves objects intact. Conflicting publishes can leave
unreferenced payloads. This intentionally trades reclamation for safety.

No database migration is needed for this manifest protocol. It does NOT make
database transactions and storage atomic, resolve ambiguous application transactions,
or provide a physical-erasure/retention service. Those require separate design and
approval. Existing caller protections retaining uploads on ambiguous transaction
failure are preserved.

Official basis:
https://developers.cloudflare.com/r2/api/s3/api/
https://developers.cloudflare.com/r2/reference/consistency/#conditional-writes
R2 documents atomic conditional PutObject. This implementation does not assume
S3 versioning or conditional physical DeleteObject support.

## Configuration required later — no values installed

| Variable | Requirement |
| --- | --- |
| API_OBJECT_STORAGE_PROVIDER | Explicitly `cloudflare-r2` |
| R2_RUNTIME_APPROVAL | Explicitly `approved-for-runtime` |
| R2_BUCKET_ACCESS | `private`; owner attestation, not a live bucket-policy check |
| R2_ACCOUNT_ID | Explicit account identifier |
| R2_ENDPOINT | Exact HTTPS account endpoint, no custom host/path/query |
| R2_ACCESS_KEY_ID | Explicit R2 S3 access key ID |
| R2_SECRET_ACCESS_KEY | Explicit R2 S3 secret; server-only |
| R2_BUCKET | One explicitly selected bucket |
| R2_OBJECT_PREFIX | Dedicated, application-owned prefix |
| R2_PRIVATE_REFERENCE_ROOT | Exact existing logical private root |
| R2_PUBLIC_REFERENCE_ROOT | Exact existing logical public root |
| PRIVATE_OBJECT_DIR | Must match private reference root |
| PUBLIC_OBJECT_SEARCH_PATHS | Must be a single matching public logical root |

Account endpoints use `https://<account-id>.r2.cloudflarestorage.com`. Scope is
validated before client creation. The selected bucket must have public access
disabled, including r2.dev and public custom domains. Even public images are served
through existing API routes; there is no public bucket URL or presigner.

Use a dedicated bucket-restricted Object Read & Write credential. No bucket
administration, other buckets, public policy changes or Cloudflare account management
permissions are required by this adapter. The R2 credential permission bundle may
permit deletion although this code never issues it. Do not grant public access to
make images work. Do not configure lifecycle deletion of manifests or payloads:
it would break tombstones, immutable references and in-flight readers.

Credential shapes and approval are checked; existence, permissions, bucket privacy,
quotas and live conditional semantics have NOT been verified against an account.
The SDK uses explicit credentials, `region: auto`, no region-following redirect,
`maxAttempts: 1`, bounded response streaming and a 15-second overall operation
budget. Sanitized categories do not include provider text, URLs or object paths.
Application files are limited to 5 MiB. MIME rules follow asset category.

## Legacy and cutover limitation

No source files are copied, changed or deleted. Existing Replit providers remain.
`readR2WithLegacy` is an optional injected read-only composition helper: it permits
fallback only after a confirmed missing manifest for a never-owned key. Tombstones,
missing payloads, invalid metadata, permission failures, timeouts and unknown
outcomes cannot fall back. Errors from an injected legacy reader are sanitized.
There is no legacy mutation fallback.

Runtime routes deliberately do NOT auto-discover/activate a legacy backend. On an
external host the Replit sidecar is unavailable; enabling R2 does not magically make
existing Replit files readable. Live inventory/copy/verification or a separately
approved, reachable, authorized read bridge is still needed before cutover. The
helper alone is not a deployed bridge or an approved migration.

## Tests and release gates

The fixture runner includes R2, existing GCS/Replit and pending Supabase tests.
All R2 tests use in-memory transports or an injected SDK HTTP handler; no Cloudflare
account is contacted. Route regressions use a disposable local PostgreSQL fixture,
never managed Supabase. Typecheck is non-emitting.

Before activation: obtain separate approval for bucket/privacy/credentials, verify
conditional API behavior with restricted test objects, reconcile and preserve legacy
assets, establish cost/retention/recovery policy, and perform authorized four-portal
acceptance. Physical erasure, garbage collection and durable outcome reconciliation
remain out of scope. No activation, migration or deployment is authorized here.
