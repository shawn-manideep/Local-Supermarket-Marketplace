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

There is **no fallback** to `SUPABASE_DB_URL`, `DATABASE_URL`, Supabase service
keys, PG defaults, a preview URL or another storage provider.

Allowed connections: direct `db.<ref>.supabase.co:5432` as `postgres`, or verified
session pooler `aws-<number>-<region>.pooler.supabase.com:5432` as `postgres.<ref>`.
Database must be `postgres`. Transaction pooling/port 6543 and custom/ambiguous
hosts are rejected. Remote TLS uses certificate verification; supply appropriate
trusted system certificates if needed, never disable verification. Networking,
pooler startup-option compatibility and managed permissions remain validation
gates; the runner has no fallback.

**Only after those gates**, the owner-approved future command is:

```sh
pnpm --filter @workspace/db run migrate:fresh \
  --project-ref <verified-new-reference> \
  --approve-project-ref <same-verified-new-reference> \
  --apply
```

The placeholders are intentionally not executable references.

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
