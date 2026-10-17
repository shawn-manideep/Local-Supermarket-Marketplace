# Fresh Supabase bootstrap — development only

## Scope and current status

This is a separate, opt-in bootstrap path, not an upgrade tool for existing
databases. No Supabase project is created by this command. It does not configure
Auth providers, EAS, deployments, GCS, buckets, accounts, seeds or demo resets.
The existing `migrate`/production commands are unchanged. **Do not use the legacy
Drizzle command for fresh replay:** it wraps pending files in one transaction.

All 26 SQL files remain unchanged. The original 17 journal entries are preserved;
nine registrations are appended with registration-time timestamps, not fabricated
historical application dates. Dependency-valid execution order:

`0000–0015 → 0023 → 0016–0022 → 0024 → 0025`

`0023` needs only foundation stores/orders. Each file commits separately, so
`0012` commits its delivery role before `0013` uses it. Statement breakpoints
are not transaction boundaries.

## Offline checks and disposable tests

From the repository root:

```sh
pnpm --filter @workspace/db run migrate:fresh --check
node --test lib/db/scripts/migrate-fresh.test.mjs
node --test lib/db/scripts/fresh-connection-safety.test.mjs
```

The suite requires installed PostgreSQL 17 binaries. Its default is the existing
Nix PostgreSQL 17.6 installation used by this repository's database tests. On
another machine set `FRESH_TEST_POSTGRES_BIN` to that machine's PostgreSQL 17
`bin` directory. Missing/wrong tools cause failure, not skips or remote fallback.

Tests initialize a temporary `/tmp` cluster, bind only to `127.0.0.1`, explicitly
set every connection parameter, and remove the cluster afterward. PostgreSQL
tool subprocesses receive an environment allowlist, not inherited PG/database
credentials. A random startup GUC proves the server is the disposable cluster.
Synthetic fixture records exist only inside that cluster.

`--local-test-token` is a test-only CLI mode: it requires loopback, a nonstandard
port, a token-derived test database, matching explicit approval and a matching
server startup token. It cannot be used with a remote host or Supabase API URL.

## Owner gates before any remote execution

Remote execution is **not authorized by implementing or running local tests**.

1. Separately approve creation of an empty development project under the intended
   organization/region and confirm Free-tier availability. Stop if a paid resource
   would be required.
2. Independently verify the newly assigned project reference in the owner's
   Supabase Dashboard. The protected existing reference
   `gkwcolipeavxnuzqlamb` is rejected unconditionally.
3. Verify managed PostgreSQL 17+, expected Auth schemas/roles and permissions,
   empty Auth users, no application tables/data, empty Storage buckets/objects,
   and no recorded application migrations. Do not copy existing records.
4. Review managed baseline objects before execution. Unknown public relations,
   types, non-extension functions or Auth triggers are refused. Do not relax the
   guard to bypass an unexplained object. Unknown non-system schemas are also
   refused; the managed-schema allowlist must be reviewed against the real new
   project's baseline before any separately approved remote execution.
5. Explicitly approve the new project reference and the migration execution.

Supply these **new, dedicated process inputs through secure server-side
environment configuration**, not chat, source control, mobile/public variables,
or shell commands containing a password:

| Input | Required value |
| --- | --- |
| `FRESH_DB_URL` | New project's admin PostgreSQL connection; no URL query options |
| `FRESH_SUPABASE_URL` | Exact `https://<approved-project-ref>.supabase.co` |
| `FRESH_DB_CA_CERT_PATH` | Optional absolute path to an owner-verified public root CA certificate; never a private key |
| `FRESH_DB_CA_SHA256` | Required with a CA path: independently reviewed SHA-256 certificate fingerprint |

There is **no fallback** to `SUPABASE_DB_URL`, `DATABASE_URL`, Supabase service
keys, PG defaults, a preview URL or another storage provider.

Allowed connections: direct `db.<ref>.supabase.co:5432` as `postgres`, or verified
session pooler `aws-<number>-<region>.pooler.supabase.com:5432` as `postgres.<ref>`.
Database must be `postgres`. Transaction pooling/port 6543 and custom/ambiguous
hosts are rejected. Remote TLS always verifies the certificate chain and hostname.
A provided CA must be a currently valid, self-signed root CA, contain no private
key, and match the explicit SHA-256 pin. Trust applies only to that client, not
the operating system or other application processes. Without an explicit CA,
Node's ordinary trusted roots are used. There is no insecure fallback.

### Explicit TLS boundary for session poolers

The client inspects its actual TLS socket, requires an authorized certificate
chain and checks the peer certificate against the exact configured hostname.
Direct connections **also** require `pg_stat_ssl.ssl=true` on the database.

For Supavisor, `pg_stat_ssl` describes the **pooler-to-database** hop, not the
external client-to-pooler TLS socket. Session-pooler use therefore requires the
separate `--acknowledge-pooler-tls-boundary` flag. This acknowledges verified TLS
to the trusted Supabase pooler; it **does not claim upstream encryption** when
the backend reports `ssl=false`. That state is explicitly reported. An absent
or uninspectable backend TLS result is still refused. Direct connections cannot
use the pooler acknowledgement to bypass their backend TLS check.

If policy requires TLS on both hops, do not acknowledge this boundary. Use the
direct endpoint from an IPv6-capable environment or separately investigate a
provider-supported encrypted-upstream configuration. Do not disable verification,
change SSL enforcement, or buy an IPv4 add-on as an automatic workaround.

The runner sets and verifies fixed **session** limits after connection instead
of trusting startup options: 30s statement, 3s lock and 20s idle-in-transaction.
It reapplies and verifies transaction-local limits before bootstrap metadata and
each complete SQL file. Read-only preflight uses 15s/3s/20s, sets the session
default to read-only, and explicitly begins a read-only transaction. These are
connection-local settings, not `ALTER ROLE` / `ALTER DATABASE` changes.
Ignored settings or a failed read-back are fatal. Client-side query and
connection deadlines remain enabled as additional bounds.

### Separate read-only preflight

`preflight-fresh.mjs` imports only Node utilities, `pg`, and the connection-safety
helper. Neither it nor that helper imports the migration runner, loads SQL files,
creates schemas/history, or can invoke `runFresh`. Allowed operations are fixed
session/transaction settings, read-only catalog/count queries and rollback.
It makes one connection attempt and has no alternate-host or reconnect path.
It requires explicit project approval and either `--check` (configuration only,
no connection) or `--read-only` (one connection). `--apply` is rejected.

Prepare the public CA path/pin as dedicated **process-local** inputs when a
separately approved connection is ready; do not edit existing application Secrets
or put the database URI/password in commands. The owner-uploaded CA is not
automatically trusted merely because a file exists.

The following is the proposed next read-only command, **not executed by the
offline implementation/tests**. It requires new connection approval and the
dedicated inputs above:

```sh
pnpm --filter @workspace/db run preflight:fresh \
  --project-ref nrnigsznectrgbgafwme \
  --approve-project-ref nrnigsznectrgbgafwme \
  --acknowledge-pooler-tls-boundary \
  --read-only
```

Replace `--read-only` with `--check` for offline input/CA validation only.
The preflight rejects existing application objects/data/history, custom Auth
triggers, unknown schemas, missing roles/helpers/columns, RLS-filtered emptiness
checks and insufficient required privileges. It inspects owners/default ACLs
and pgcrypto availability. Successful catalog inspection does not prove later
DDL, Auth, PostgREST or Storage runtime behavior.

**Only after those gates**, the owner-approved future command is:

```sh
pnpm --filter @workspace/db run migrate:fresh \
  --project-ref <verified-new-reference> \
  --approve-project-ref <same-verified-new-reference> \
  --apply
```

The placeholders are intentionally not executable references.
For a session-pooler migration command, also include
`--acknowledge-pooler-tls-boundary` after separately accepting that boundary.
This flag is not migration authorization: exact project approval and `--apply`
remain mandatory, and all identity/empty-target/history safeguards remain.

## History, locking, failures and resume

The runner checks server/database/role identity, obtains a nonblocking
session-level advisory lock (held across commits), and refuses existing
application data or populated Supabase migration history. It never adopts an
existing Drizzle ledger, even an empty one, without its own bootstrap marker.

A fresh initialization creates `drizzle.__fresh_bootstrap` and
`drizzle.__drizzle_migrations`. The marker pins the exact project and ordered
manifest (tags, indices, timestamps, SHA-256 hashes), including unapplied files.
Application SQL and its history insert commit in the same transaction. Earlier
files stay committed if a later file fails. No baseline or ledger is rewritten.

Resume is allowed only for the same target and identical manifest, with an exact
recorded prefix. Hashes, timestamps, unknown rows/objects and inconsistent marker
state cause refusal. A PostgreSQL sequence gap after rollback is valid and is not
repaired. A completed rerun is a no-op while the target remains empty.

If failure was environmental, resolve it and rerun the identical command. If SQL
or history differs, **stop for review**; never edit ledger rows, mark files as
applied manually, replace committed SQL or backdate metadata. An early SQL defect
cannot necessarily be fixed by appending a later migration.

This narrowly scoped bootstrap is not a full schema-drift auditor or a continuing
upgrade path. Keep the target isolated until validation passes. Do not rerun
after adding fixtures/live records; nonempty state is deliberately rejected.

## Remaining managed-service validation

Local tests use minimal synthetic Auth objects, not Supabase services. They do
not prove real signup/recovery, Auth service ownership/permissions, PostgREST JWT
and API behavior, managed default grants, network/TLS reachability or Storage
policies. Those require separately authorized checks on the new project. GCS
integration remains unchanged; storage setup and fixtures need separate approval.
