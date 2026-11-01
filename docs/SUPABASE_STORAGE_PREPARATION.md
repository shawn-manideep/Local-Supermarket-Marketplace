# Supabase Storage — offline provider prototype

## Release boundary

This is not a deployable Storage client. No buckets, policies, credentials,
environment settings, database objects or stored assets have been changed.
Existing providers and the default `replit-gcs-sidecar` remain selectable.
There is no live Supabase SDK connector, credential loader, fixture installer,
bucket creator, migration executor or activation switch.

`getSupabaseAssets()` always refuses live operations. API-only startup validates
the configuration and existing target/key/TLS/signing-secret guards, then refuses
this provider before opening a database connection or loading the application.
Ordinary startup also cannot unlock Storage: all Supabase feature branches call
the disabled resolver. Selecting a provider is not runtime authorization.

## Offline configuration

Pure validation accepts a supplied configuration record only:

- `API_OBJECT_STORAGE_PROVIDER=supabase-storage`
- `SUPABASE_URL`: exact HTTPS origin for isolated project `nrnigsznectrgbgafwme`
- `SUPABASE_STORAGE_BUCKET`: fixed private-bucket binding
- `SUPABASE_STORAGE_PUBLIC_REFERENCE_ROOT`
- `SUPABASE_STORAGE_PRIVATE_REFERENCE_ROOT`
- `PUBLIC_OBJECT_SEARCH_PATHS`: the same single normalized public root
- `PRIVATE_OBJECT_DIR`: the same normalized private root

Do not configure these variables yet. No key is required or read by the prototype.
Public/private roots must be safe, exact and disjoint. Bucket identity and a
private-bucket assertion are checked against the injected port; those assertions
are NOT evidence of live bucket privacy, authorization or IAM.

## Basic operations versus concurrency

The basic preparation port exposes metadata, create-only upload (`upsert:false`)
and download. It has no overwrite/delete/public-URL/signed-URL method. Keys are
restricted to the four application namespaces. Uploads are bounded at 5 MiB;
branding and feature MIME restrictions remain enforced separately. SDK cache
options use numeric `0`; API private/no-store headers remain authoritative.

Basic download is explicitly not an ObjectStore revision-pinned read.
The strict ObjectStore bridge additionally requires injected capabilities for
`readAtRevision`, `replaceIfRevision` and `deleteIfRevision`. Without each
capability its corresponding operation fails before dispatch. An opaque revision
is not a GCS generation. The current SDK's version-related interfaces are not
proof that the hosted service/Free plan supplies atomic CAS or retained versions.
No native concurrency implementation or custom-header workaround is provided.

In-memory capabilities prove only application-side contracts. No claim of live
atomicity, checksum transport validation, metadata completeness, quotas, cost,
retention, crash recovery or production authorization acceptance is made.

## Failure and cancellation boundary

Request/overall deadlines, request-count ceilings and single-flight execution
bound fixture operations. Abort signals propagate to injected ports. Cleanup is
bounded, acknowledgement is recorded, and failed cleanup never replaces the
original error. An uncooperative transport is closed logically; this does not
prove its remote operation stopped. No retries occur.

After a dispatched mutation, cancellation, response loss or an unclassified
provider failure yields `UNKNOWN_OUTCOME`. Reconcile before retrying. A timeout
is not proof the object was not created. Conflicts are fixed categories and never
trigger an unconditional retry. Error messages contain no SDK details or causes.

## Feature behavior and security

Product URLs, private object references and branding endpoints remain unchanged.
Storage adapters do not authorize users; the unchanged API role, store ownership,
publication/compliance and assignment guards do. All destination objects must be
private. No anonymous/authenticated direct Storage policies or public buckets
are proposed. A backend service-role credential would bypass Storage RLS, so it
must never reach frontend/Expo code and cannot replace route authorization.

Reference preservation remains inventory-dependent. Full normalized legacy paths
are logical destination keys, including any old bucket-like segment. Source
bucket-relative names, MIME sidecars and branding manifests need explicit mapping.
No inventory or copying is implemented.

## If native atomic guarantees are insufficient

Use immutable object names plus an application-owned revision pointer. For
branding: upload a new immutable version, atomically compare-and-swap the active
pointer, serve its exact object, and preserve prior versions during rollback.
Pointer state needs durable transactional storage, not a process-local lock.
Any required schema is a separately approved forward migration; never edit the
26 applied migrations. Conditional garbage collection must reconcile references
and concurrent writers. Do not implement path-only deletion to emulate CAS.

## Verification

Run `node backend/api/scripts/run-supabase-storage-fixtures.mjs`.
The runner inherits no environment, uses the existing strict inventory no-I/O
guard and ephemeral module doubles. All networking (including loopback) and
conventional credential-file reads are blocked. No PostgreSQL process or DDL/DML
is used. Node's experimental module-mocking warning is expected.

Tests cover configuration/binding/path validation, duplicate creation, bytes/MIME,
capability refusal, revision conflicts, cancellation, uncertain writes, cleanup,
role middleware and real document store scoping with fake Auth/DB/Storage.
Delivery assignment and product-publication route checks also include static
guard assertions; these are not full live/HTTP acceptance tests.

Remaining separately approved gates: native capability verification, current Free
plan limits and capacity budget, connector implementation, private bucket/policy
setup, inventory/mapping, protected recovery journal, copying, writer pause,
cutover/rollback and authenticated live acceptance. Railway/Vercel/EAS activation
is outside this prototype.
