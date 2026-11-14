# Cloudflare R2 preparation — inactive, offline-verified only

## Delivery-photo-only routing (Stage A — not activated)

The optional `API_DELIVERY_PHOTO_STORAGE_PROVIDER=cloudflare-r2` selector is
absent by default. It is a category-specific exception, not a global activation.
It requires `API_OBJECT_STORAGE_PROVIDER=disabled`,
`API_ONLY_TARGET_PROFILE=isolated-native-preview`, and no
`API_ASSET_STORAGE_PROVIDER` (even an empty shared override is rejected).
The full existing API-only target, project/key, database URL/TLS/timeout and
signing-secret validation still applies before any R2 client is constructed.

The existing `API_VENDOR_DOCUMENT_STORAGE_PROVIDER` and its Supabase exception
are unchanged and can coexist with this photo selector. Vendor operations never
consult the photo selector. Product images and branding still reach the disabled
global guard. No Supabase general-storage operations or Replit fallback are enabled.

Photo-only construction uses its own cache, revalidates on every access, and
reconstructs after a valid configuration change. It exposes only `put/get/discard`
for photos. A second restriction inside `r2ObjectStore` rejects other categories
before any transport request, including `head/read/write/remove` attempts.
The existing global R2 constructor remains unchanged and separate.

Future configuration would also require the existing validated R2 settings:
`R2_RUNTIME_APPROVAL=approved-for-runtime`, `R2_BUCKET_ACCESS=private`,
`R2_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_OBJECT_PREFIX`, `R2_PRIVATE_REFERENCE_ROOT`,
`R2_PUBLIC_REFERENCE_ROOT`, `PRIVATE_OBJECT_DIR`, and
`PUBLIC_OBJECT_SEARCH_PATHS`. The private/public logical roots must match the
existing application roots and remain disjoint. This preserves the existing
reference structure:
`PRIVATE_OBJECT_DIR/delivery-photos/<assignment UUID>/<photo UUID>`.
No configuration values, credentials, buckets or policies are installed by this work.
`R2_BUCKET_ACCESS=private` is a required declaration, not proof of cloud privacy.

The API keeps assignment/role checks and the existing upload-before-transaction
sequence. A replacement creates a fresh logical reference, commits the DB pointer,
and only then attempts a conditional tombstone of the previous reference. On a
failed or ambiguous DB transaction, newly uploaded objects are retained; there
is no destructive cleanup or retry. A lost storage response can leave an
unreferenced manifest/payload, which is deliberately retained.

Offline integration tests inject only the SDK send boundary: real selectors,
transport, scoped adapter, manifest verification, authenticated routes and disposable PostgreSQL
persistence are exercised. The fixture pool remains pinned to its already-created
loopback connection; isolated-project metadata is used only for pure guard
validation. Auth responses are synthetic and a network guard blocks non-loopback
connections. This does not demonstrate live R2 credentials, privacy, permissions,
conditional-write semantics, production DB access or browser/device acceptance.

Rollback: remove the photo selector to restore blocked photo operations without
changing Vendor, product or branding routing. R2-backed photo retrieval will also
be unavailable until compatible routing is restored. Retain all DB references,
payloads and permanent tombstones; never roll back by deleting objects or applying
blanket lifecycle expiry. The same limitation applies to deploying older code.
Existing objects are not copied or discovered automatically; no legacy read fallback
exists in this route. Retention/orphan growth and request/storage quotas need
separately approved monitoring and acceptance. No automatic garbage collection,
physical erasure, paid service or production activation is introduced.

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

After each acknowledged create-only payload PUT, the adapter also reads back that
exact immutable key and verifies its byte length, SHA-256 and accepted signature
**before** attempting manifest publication. Verification uses the same overall
15-second operation budget and a streaming limit equal to the expected payload
size. Missing/corrupt payloads fail closed; unavailable verification does not
publish a manifest. Failed replacement verification leaves the old manifest intact.
There are no automatic verification or mutation retries, nor destructive cleanup.
This read-back strategy is used instead of assuming an unverified R2 checksum-header
contract. It adds one payload GET per write and associated latency/usage. Integrity
still assumes exclusive application ownership of immutable keys; it does not
protect against a privileged external actor overwriting objects after verification.

Manifest ETags are bounded strong HTTP entity-tags (at most 1024 characters),
treated as opaque tokens and forwarded byte-for-byte in If-Match. They are not
restricted to hexadecimal hashes or normalized. Weak tags, unquoted tokens, lists,
control characters and embedded quotes are rejected.

Delete is a conditional **logical tombstone**, not physical erasure. Keys are never
reused, tombstones are permanent, and payloads are retained. No DeleteObject,
listing, multipart, copying, unconditional overwrite, mutation retry or automatic
cleanup is implemented. Losing a response may mean a write committed; the adapter
reports UNKNOWN_OUTCOME and leaves objects intact. Conflicting publishes can leave
unreferenced payloads. This intentionally trades reclamation for safety.

### Retention and recovery safeguards

- Manifests and tombstones are permanent ownership records. Never delete them,
  expire them through lifecycle rules, or restore payloads without their ownership
  history. A missing tombstone can make an owned key look never-owned, enabling
  key reuse or legacy fallback. Recovery must preserve tombstones and reconcile
  manifest history before enabling writes or fallback.
- Replacements retain older payloads. CAS losers, failed read-back verification
  and ambiguous PUTs can retain orphan payloads. These are not safe to erase merely
  because they are old or absent from one database/manifest snapshot.
- Before activation, assign an owner and budget for monitoring total stored bytes,
  object count, write/read usage, retained revisions, orphan growth and quota alerts.
  No monitor or quota enforcement is installed by this offline preparation.
- Future garbage collection requires separately approved inventory/reconciliation,
  a durable recovery journal, protection for all live database references and
  in-flight readers, and conservative handling of unknown outcomes. Tombstones
  must remain permanent. Do not introduce blanket lifecycle deletion rules.
- Logical deletion is not physical erasure. Any physical-erasure obligation needs
  a separately designed and approved process; this adapter provides none.

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

## Cancellation limitation

The ObjectStore and existing asset/route interfaces carry no request-scoped
AbortSignal. The cached runtime asset factory therefore cannot safely propagate
one caller's disconnect without broader API changes. Do not attach a request signal
to the shared singleton: aborting it could affect other callers.

The store's injected signal remains available to isolated callers/tests. Runtime
operations retain their independent internal controller and 15-second deadline.
After a timeout/cancellation following mutation dispatch, UNKNOWN_OUTCOME is
conservative: an already-dispatched PUT may still commit. No later request is sent
after the controller aborts, but abort is not a rollback. A request disconnect alone
does not abort runtime work, which may continue until completion or its deadline.
No new request-scoped cancellation interface is introduced in this change.

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
