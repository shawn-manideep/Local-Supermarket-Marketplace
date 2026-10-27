# API-only Replit deployment preparation

**Current preparation:** an owner-controlled external GCS compatibility adapter
is available behind explicit, complete configuration and a runtime approval
guard. It is not activated. See [External GCS preparation](EXTERNAL_GCS_PREPARATION.md).
The App Storage setup sequence below remains an alternative, not an instruction
to provision storage or copy any data.

This is a source and local-test preparation document. It does not create a
Replit project, set Secrets, contact Supabase or App Storage, run migrations,
publish, or build a mobile app.

There are two code-defined API-only target profiles:

- `original-customer-apk` targets the original Customer Supabase project.
- `isolated-native-preview` targets the isolated preview project.

The profile name selects a fixed code map. Environment variables cannot select
an arbitrary Supabase project.

## Deployment boundary

Use the canonical `backend/api` package from the
`development/fresh-supabase-runner` branch. Do not deploy the current Repl:
Replit publishes the artifacts registered in a project, so the Customer,
Dashboard, and other portal artifacts must remain in their existing project.
The future deployment must be a separate Replit project whose only registered
service is the API. The API package—not `artifacts/api-server`'s web preview
wrapper—is the source of truth. The current wrapper runs the separate
`@workspace/api-server` package and is not the guarded `@workspace/api`
entrypoint. Replit's artifact registry is project-scoped, and publishing the
current project is not an API-only operation.

### Repository and workspace layout

Use the repository root and the full checkout on the approved branch. The
existing frozen lockfile has importers for the monorepo workspace; deleting
portal/artifact directories to make a smaller checkout would make that lockfile
inconsistent. The checkout may contain other source files, but the new Replit
project must register and run only the API service.

The API package and its required workspace packages are:

| Path | Workspace package | Purpose |
| --- | --- | --- |
| `backend/api/` | `@workspace/api` | Existing Express API, API-only entrypoint, routes, fonts, and storage adapters |
| `lib/db/` | `@workspace/db` | PostgreSQL pool, Drizzle schema, and database package |
| `packages/validation/` | `@workspace/validation` | API request and domain validation schemas |
| `packages/shared-types/` | `@workspace/shared-types` | Shared role/types imported by API authentication code |

Keep the root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`,
and `tsconfig.base.json`. The API build script builds Validation and DB; on a
fresh checkout, build `shared-types` first because the API typecheck resolves
its generated declaration file from `packages/shared-types/dist/`.

Do not copy the current root `.replit` workflow configuration into the new
project unchanged: it starts multiple existing portal/preview workflows and
contains project-specific bindings. Configure the new project's run/build
settings to start only `@workspace/api` with `start:api-only`. Do not reuse
`artifacts/api-server/.replit-artifact/artifact.toml`; that manifest targets
the preview wrapper, not the API-only entrypoint. Before publishing, verify
that the new project's artifact/service registry contains only the API. If
the import process registers other portal services and they cannot be excluded
project-locally, stop rather than publishing.

The checked-in root `.replit` will arrive with a repository import. The new
project therefore needs a project-local configuration that does not start its
portal workflows or inherit the current project's environment/storage bindings.
Keep that override in the new project only; do not commit it to the shared
branch. If Replit cannot keep the API-only configuration separate from the
shared branch, stop and have the owner prepare an isolated deployment branch
or source copy before proceeding.

## Commands

Run from the repository/workspace root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/shared-types run build
pnpm --filter @workspace/api run build
pnpm --filter @workspace/api run start:api-only
```

Set the new project service's build step to the first three commands and its
run step to the final command. Replit supplies `PORT`; the API binds to
`0.0.0.0`. The ordinary `start` script and `backend/api/src/index.ts` remain
the existing path. `start:api-only` requires `API_ONLY_TARGET_PROFILE` to
select one of the fixed profiles, validates that profile, opens its read-only
database identity check, and only then dynamically loads the shared API app.

## Required configuration in the separate project

Add server-side values through that project's Secrets/environment controls;
never commit them or put server credentials in `EXPO_PUBLIC_*` variables.

**Server-side Secrets**

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `SESSION_SECRET` (at least 32 characters)
- `MASTER_CATALOG_REVIEW_TOKEN_SECRET` (at least 32 characters)

`FRESH_DB_URL` and `FRESH_SUPABASE_URL` are not fallbacks and are not read by
the API-only entry point. `SUPABASE_DB_URL` must match the selected
code-defined profile; the API uses no `DATABASE_URL`, old development URL, or
cross-project fallback.

**Non-secret allowlist/configuration**

- `API_ONLY_TARGET_PROFILE=original-customer-apk` for the original Customer APK
  API, or `isolated-native-preview` for the isolated preview target. Missing
  and unknown profiles fail startup.
- `API_OBJECT_STORAGE_PROVIDER` — required, explicit selection of
  `replit-app-storage` or `external-gcs`. External GCS has additional mandatory
  guards and reference mappings documented separately.
- `PRIVATE_OBJECT_DIR=private` for the Replit App Storage option only.
- `PUBLIC_OBJECT_SEARCH_PATHS=public` for the Replit App Storage option only.
- `CORS_ALLOWED_ORIGINS` — leave empty for native-only requests. If a browser
  Customer client is intentionally moved to this API, set only its confirmed
  HTTPS origin(s), as comma-separated origins without paths or trailing
  slashes. Do not add portal origins that should remain on the existing API.
- `PORT` is provided by the Replit service.

The original Customer APK profile is fixed to the following owner-confirmed
database endpoint:

| Setting | Required value |
| --- | --- |
| Project reference | `gkwcolipeavxnuzqlamb` |
| Supabase URL | `https://gkwcolipeavxnuzqlamb.supabase.co` |
| Database | `postgres` |
| Connection mode | Session pooler |
| Host | `aws-0-ap-south-1.pooler.supabase.com` |
| Port | `5432` |
| Username | `postgres.gkwcolipeavxnuzqlamb` |
| TLS | `sslmode=verify-full` |
| Connection timeout | 10 seconds |

The isolated preview profile remains separate and accepts only its exact
direct endpoint, `db.nrnigsznectrgbgafwme.supabase.co`, port `5432`, database
`postgres`, and database user `postgres`. Its unconfirmed pooler endpoint is
not accepted.

The guard checks the selected profile's Supabase URL and JWT `ref`/`role`
claims, exact database host/user/port/mode, TLS, connection timeout and storage
namespaces. It rejects host overrides and any connection timeout other than
the profile's fixed 10 seconds. Legacy `API_ONLY_EXPECTED_DB_*` values, if
present, are comparison-only and cannot select or override a target.

After those checks it opens one database session, runs `BEGIN READ ONLY`,
checks `current_database()`, and rolls back. Its individual queries use
five-second client timeouts. A failed connection or identity check prevents the
API app from loading or listening. The check is implemented only in
`start:api-only` and has not been run against Supabase here. It never prints
values. JWT claim checks are a configuration mismatch guard, not signature
verification; Supabase verifies tokens when requests are made.

After that check, the API-only entrypoint initializes the shared pool before
loading the app with:

- `connectionTimeoutMillis`: the selected profile's validated 10-second
  `connect_timeout`, converted to milliseconds.
- `statement_timeout`: 60 seconds, sent as a PostgreSQL server-side setting.
- `query_timeout`: 65 seconds, as a client-side safeguard.

All API routes using `getDb()` in the API-only process share this pool. A
timeout error is propagated; the API does not retry timed-out statements or
writes. Existing normal API startup calls `getPool()` without these options, so
its default behavior is unchanged. Per-statement limits do not impose a total
transaction-duration limit.

## Storage and access boundaries

Unset `API_OBJECT_STORAGE_PROVIDER` continues to use the current Replit GCS
sidecar implementation. The exact value `replit-app-storage` enables the
SDK adapter; `external-gcs` requires the separately documented complete
configuration and approval guard. Unknown values fail rather than falling back.
For the Replit App Storage option, the new project must explicitly set
`API_OBJECT_STORAGE_PROVIDER=replit-app-storage` and provision App Storage from
that project's App Storage setup. Replit creates a project-scoped bucket only
after explicit setup; each project owns its own bucket. SDK credentials are
provided by the new project's integration. Do not copy the existing project's
`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, GCS sidecar credentials, or any objects.
Use `PRIVATE_OBJECT_DIR=private` and `PUBLIC_OBJECT_SEARCH_PATHS=public` in the
new project.

The SDK does not expose the existing GCS content metadata/generation fields.
Product-image MIME types are stored in companion metadata objects. Branding
uses versioned image objects and an active manifest so a failed manifest
replacement does not replace the current image. Vendor documents and
delivery-partner photos stay under separate `private/` namespaces. Their
existing authenticated API routes remain the only read path. Product and
branding images also remain API-mediated; no object URL or public bucket
access is added. Existing GCS code remains the default.

When using the Replit App Storage option, the original-project profile requires
App Storage in the separate API Replit project. That bucket is not shared with the existing portal project's
GCS sidecar bucket, so this profile alone does not provide the existing assets.
Shared storage, object copying, and synchronization are a separate blocked
workstream; no storage data is copied or exposed by this preparation.

## Deployment and verification sequence (not performed)

1. The owner creates a separate Replit project from the approved repository
   branch. Keep the existing portal project untouched. Configure only the API
   service to run; Replit publishes the whole new project, not one selected
   artifact.
2. In the new project, explicitly set up its own App Storage bucket. Confirm
   that the API-only service uses the `replit-app-storage` provider and the
   `private/` and `public/` namespaces. Do not copy the old bucket or objects.
3. Select the fixed target profile. The original Customer APK profile uses the
   owner-confirmed endpoint below:

   | Setting | Required value |
   | --- | --- |
   | Project reference | `gkwcolipeavxnuzqlamb` |
   | Database | `postgres` |
   | Connection mode | `session` |
   | Hostname | `aws-0-ap-south-1.pooler.supabase.com` |
   | Port | `5432` |
   | Username | `postgres.gkwcolipeavxnuzqlamb` |
   | TLS | `sslmode=verify-full` |
   | Connection timeout | `connect_timeout=10` seconds |

   The isolated profile remains separately fixed to this direct endpoint; its
   session-pooler endpoint is not accepted until owner-confirmed and added to
   the code-defined profile:

   | Setting | Required value |
   | --- | --- |
   | Project reference | `nrnigsznectrgbgafwme` |
   | Database | `postgres` |
   | Connection mode | `direct` |
   | Hostname | `db.nrnigsznectrgbgafwme.supabase.co` |
   | Port | `5432` |
   | Username | `postgres` |
   | TLS | `sslmode=verify-full`; do not disable certificate or hostname verification |
   | Connection timeout | `connect_timeout=10` seconds |

   The connection URL may include only the guard-approved query settings:
   `sslmode`, optional reviewed `sslrootcert`, and `connect_timeout`; do not
   add host/user/password overrides. The separate migration runner's
   `FRESH_DB_URL` instructions are not the API's `SUPABASE_DB_URL` and are not
   fallback values.

   The known direct host `db.nrnigsznectrgbgafwme.supabase.co` currently resolves
   only to IPv6 in this environment; the TCP probe to port 5432 failed with
   `EAFNOSUPPORT` before any database connection was made. The actual session
   pooler hostname is still unknown, so its DNS and TCP reachability have not
   been checked.
4. Add the API-only Secrets and non-secret allowlist settings in the new
   project's Tools → Secrets/environment controls. Set
   `API_ONLY_TARGET_PROFILE` to the intended code-defined profile and confirm
   that the Supabase URL and API-key claims match it. Never copy values from
   the current Repl.
5. Run the local build and tests. Starting `start:api-only` requires a separate
   approval because it opens a database session for the read-only identity
   check. It must fail closed if the owner-confirmed URL, username, port, mode,
   or project identity does not match.
6. Publishing the separate project requires separate approval. Use only the
   generated HTTPS URL after publishing; do not invent one. For a directly
   called mobile API, do not embed a Replit private-access token in the APK.
   Check `GET /health` and `GET /api/health`, for example:
   `curl -i "https://<generated-API-origin>/health"`. These are process
   liveness checks only, not proof of database, Auth, or storage readiness.
7. Perform a separately authorized read-only Supabase identity/schema
   preflight, then obtain separate approval for any schema initialization or
   functional testing. The isolated database is currently uninitialized; the
   original database must be verified as-is. Do not run the fresh database
   migration runner against the original project.
8. After App Storage is provisioned, verify private-document and
   delivery-photo authorization, product-image active-listing/vendor access,
   and branding responses. No remote storage verification has been performed.

The Customer Expo `preview` APK profile is mapped to the original project.
After a stable HTTPS API origin exists and the separate storage blocker is
resolved, configure `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_SUPABASE_URL=https://gkwcolipeavxnuzqlamb.supabase.co`, and the
matching public JWT anon key in the EAS preview environment. Never put the
service-role key or database URL in the mobile app.

## Local checks

From the workspace root:

```sh
pnpm --filter @workspace/api run test:api-only
pnpm --filter @workspace/api run typecheck
pnpm --filter @workspace/api run build
```

These checks use local fakes and a loopback HTTP server. They do not connect to
Supabase, run migrations, or access remote storage.
