# Restricted transports and approval binding — offline preparation

## Scope and execution boundary

Work continues from the existing branch without production integration. No real
database/storage SDK connector, credential loader, live signing authority, network
endpoint, CLI flag or environment activation is provided. The existing CLI still
refuses metadata execution. Production routes and storage providers are unchanged.

The request permits disposable database tests but also prohibits database queries.
This work follows the stricter boundary: all database commands are captured by
in-memory mock ports. No local or live database was queried. Storage listing,
metadata and cancellation responses are also mocked, without object operations.

`prepared-transports.ts` implements fixed SQL orchestration, source metadata
mapping and bounded reader composition. `prepared-approval.ts` implements signed
fixture approval validation. The physical authenticated connectors and production
trust configuration remain absent, not implicitly verified by these adapters.

## Database transport

- Construction consumes a valid, single-use prepared capability before any port
  call. Construction itself does not connect.
- The connection plan fixes the original project, session-pooler host, port 5432,
  database, approved restricted role, certificate verification and connect timeout.
  It has no URL/password/credential field or environment fallback.
- Before reading asset projections, the adapter issues fixed `BEGIN READ ONLY`,
  bounded transaction-local statement/lock/idle timeouts and a fixed identity/
  read-only preflight. A role, database or transaction-mode mismatch stops the run.
- Table and columns come solely from the existing allowlist. UUID keyset cursors
  and limits are parameters; table/column identifiers are never caller SQL.
  Timestamp expressions are fixed to the reviewed projection. Unexpected/private
  columns, malformed identifiers and out-of-order rows fail closed.
- A full page produces a continuation cursor rather than fetching an unbudgeted
  extra row. If the budget prevents proving a terminal page, the result remains
  incomplete, including when the true total happens to equal the budget exactly.
- Connection attempts and preflight/data commands consume a separate physical
  operation ceiling, with one slot reserved for cleanup acknowledgement. Public
  summaries distinguish physical operations from the wrapper's logical pages.
  The future connector must implement cancel/settle and rollback-or-discard/release
  as a bounded cleanup operation, with no hidden retries or unaccounted probes.

The mocked connection plan is not proof of original-project network identity or
TLS negotiation. `current_database` and `current_user` cannot independently prove
which Supabase project is hosting a connection. Actual target enforcement must
come from a separately reviewed pinned connector and authenticated configuration.

## Source metadata transport

- One source identity is bound by signed approval and trusted fixture context.
  A supplied port reporting another identity is rejected before execution.
- Namespace selection is allowlisted; callers cannot choose buckets, URLs, field
  projections or physical prefixes.
- The mapping is explicitly **source** mapping: a signed logical root includes
  the bound source-bucket identity, while the metadata list prefix omits that one
  known bucket segment. Returned physical names regain it for reconciliation.
  This is not the external destination adapter's whole-legacy-key copy mapping.
- Only projected metadata pages are accepted. Traversal, cross-namespace names,
  extra fields, malformed sizes/generations, invalid metadata and repeated page
  tokens stop the scan. No byte downloads, URLs, uploads/copies/deletes or IAM
  operations are exposed.
- Errors from source ports are converted to fixed incomplete categories by the
  existing bounded wrapper. SDK/permission messages are not reflected.

Real source listing compatibility and permissions are unknown. The port's claimed
identity is a trusted-adapter assertion, not remote attestation. Original
Replit-managed storage access cannot be assumed for an external service identity.

## Authenticated approval preparation

An Ed25519 signature covers the exact payload bytes, including:

- Original Supabase project and metadata-inventory-only operation.
- Approved opaque operator and authenticated session handles.
- Source identity, restricted DB role and exact public/private logical roots.
- Exact inventory policy: namespace/history scope and every limit.
- Issue time, bounded expiry and nonce.

The verifier rejects unknown fields, other operations/projects, privileged roles,
scope expansion, wrong identities, stale/future approvals and invalid signatures.
It rechecks the trusted context at capability consumption. Capabilities are opaque
WeakMap entries: copied objects cannot authorize construction, and consumption is
single-use. Replay nonces are shared across same-key verifier instances in one
process, bounded and retained until expiry.

Only ephemeral synthetic signing keys and a mocked authenticated context are used
in tests. No real operator identity, signing key, credential or approval is loaded
or issued. A developer calling the test factory with a self-chosen key is NOT a
production trust boundary. Integration must pin an owner-approved public authority
and trusted authentication outside operator-controlled input.

Missing production controls: durable atomic multi-process/restart replay storage,
real operator authentication, key custody/rotation/revocation, authenticated audit,
continued session revocation/cancellation and trusted source-identity binding.
The current signature tests do not establish live owner approval enforcement.

## Cancellation and incomplete reporting

All calls are wrapped by existing row/object/page/request/deadline controls.
Signals reach mocked connect/query/list work. On failure or cancellation both
cleanup paths are attempted, even if one fails. Cleanup acknowledgement is bounded;
failure is exposed as unconfirmed, and the reader cannot be reused. Errors and
aggregate summaries do not contain approval payloads, raw identifiers, paths or
source messages. Internal pages and protected approval bindings are not reports
and must never be logged or exposed to public callers.

Actual query cancellation, rollback, connection discard, HTTP termination and TLS
must still be tested with approved real drivers in a separately authorized safe
setup. A trusted callback can ignore signals or lie about completion; JavaScript
wrappers cannot forcibly terminate arbitrary remote work.

## Offline call-path security review

| Boundary | Local evidence / disposition |
| --- | --- |
| CLI input/configuration | Existing fixed modes and bounded stdin remain unchanged; no new environment/flag/key-loader path |
| Approval verification | Signature, exact schema, target, operation, principal, scope, expiry and replay negative tests |
| Transport construction | Valid capability consumed before port calls; invalid/copied/replayed capabilities fail |
| Database access | Fixed SQL/projections, parameterized cursors, read-only preflight and physical budgets tested against mocks |
| Storage access | Fixed source identity/prefix/metadata fields; traversal and cross-namespace denial tests |
| Failure handling | Redacted incomplete outcomes; both cleanup paths attempted; no automatic retries |
| Application integration | New modules absent from CLI, runner grants and production entrypoints |
| Live enforcement | BLOCKED: physical connectors, trust/replay persistence, permissions and integration review absent |

This is a local source review and negative-test result, not an independent audit,
full security scan or production certification.

## Next separate approval

Approve a production-integration design review covering pinned connector identity,
TLS, a least-privilege original-project reader, source listing capability, trusted
operator authentication and durable replay enforcement. Any connector testing that
executes database queries needs explicit clarification/approval given this request's
query prohibition. Live inventory execution remains a separate later gate.

No permission grants, credentials, cloud resources, billing, migrations, object
copying, provider activation, deployment, EAS or APK work is authorized by this
preparation.

## Final focused verification

| Command | Result |
| --- | --- |
| `pnpm --filter @workspace/api run typecheck` | Exit 0 |
| `pnpm --filter @workspace/api run test:inventory` | 67 passed, 0 failed, 0 skipped |

The suite consists of 32 inventory checks, 21 prior preparation checks and 14
transport/approval checks. It runs through the established empty-environment
no-I/O guard, including blocked loopback and conventional credential-file reads.
All SQL and metadata operations in these tests are in-memory mock calls.
No broader API/Customer rerun or live-auth check was performed.
