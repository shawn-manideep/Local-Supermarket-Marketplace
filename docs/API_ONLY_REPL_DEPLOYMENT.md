# API-only Replit deployment preparation

This is a source and local-test preparation document. It does not create a
Replit project, set Secrets, contact Supabase or App Storage, run migrations,
publish, or build a mobile app.

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
the existing path. `start:api-only` validates the isolated target, opens its
read-only database identity check, and only then dynamically loads the shared
API app.

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
the API-only entry point. `SUPABASE_DB_URL` must be the isolated project's
owner-provided connection string; the API uses no `DATABASE_URL`, old
development URL, or protected-project fallback.

**Non-secret allowlist/configuration**

- `API_OBJECT_STORAGE_PROVIDER=replit-app-storage` — required, explicit opt-in.
- `API_ONLY_EXPECTED_DB_HOST`, `API_ONLY_EXPECTED_DB_USERNAME`,
  `API_ONLY_EXPECTED_DB_PORT`, and `API_ONLY_EXPECTED_DB_MODE` — must match
  connection details confirmed by the project owner. `direct` is accepted only
  for `db.nrnigsznectrgbgafwme.supabase.co`. A pooler is accepted only with
  mode `session`, a `*.pooler.supabase.com` hostname, and a username containing
  the isolated project reference. Do not guess any pooler value.
- `PRIVATE_OBJECT_DIR=private`.
- `PUBLIC_OBJECT_SEARCH_PATHS=public`.
- `CORS_ALLOWED_ORIGINS` — leave empty for native-only requests. If a browser
  Customer client is intentionally moved to this API, set only its confirmed
  HTTPS origin(s), as comma-separated origins without paths or trailing
  slashes. Do not add portal origins that should remain on the existing API.
- `PORT` is provided by the Replit service.

The startup guard rejects the protected reference, a Supabase URL/key whose
JWT `ref` or `role` claims do not match, unexpected database host/user/port,
host overrides, non-`verify-full` TLS, and missing or unbounded
`connect_timeout` (must be 1–30 seconds). After those checks it opens one
database session, runs `BEGIN READ ONLY`, checks `current_database()`, and
rolls back. Its three individual queries use five-second client timeouts. A
failed connection or identity check prevents the API app from loading or
listening. The check is implemented only in `start:api-only` and has not been
run against Supabase here. It never prints values. JWT claim checks are a
configuration mismatch guard, not signature verification; Supabase verifies
tokens when requests are made.

After that check, the API-only entrypoint initializes the shared pool before
loading the app with:

- `connectionTimeoutMillis`: the validated `connect_timeout` value, converted
  to milliseconds (allowed range 1–30 seconds).
- `statement_timeout`: 60 seconds, sent as a PostgreSQL server-side setting.
- `query_timeout`: 65 seconds, as a client-side safeguard.

All API routes using `getDb()` in the API-only process share this pool. A
timeout error is propagated; the API does not retry timed-out statements or
writes. Existing normal API startup calls `getPool()` without these options, so
its default behavior is unchanged. Per-statement limits do not impose a total
transaction-duration limit.

## Storage and access boundaries

Unset `API_OBJECT_STORAGE_PROVIDER` continues to use the current Replit GCS
sidecar implementation. Only the exact value `replit-app-storage` enables the
new SDK adapter; an unknown value fails rather than switching providers.
The new project must explicitly set
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

## Deployment and verification sequence (not performed)

1. The owner creates a separate Replit project from the approved repository
   branch. Keep the existing portal project untouched. Configure only the API
   service to run; Replit publishes the whole new project, not one selected
   artifact.
2. In the new project, explicitly set up its own App Storage bucket. Confirm
   that the API-only service uses the `replit-app-storage` provider and the
   `private/` and `public/` namespaces. Do not copy the old bucket or objects.
3. Obtain the exact session-pooler endpoint from the owner’s Supabase project
   connection details. The current repository records the required values as:

   | Setting | Required value |
   | --- | --- |
   | Project reference | `nrnigsznectrgbgafwme` |
   | Database | `postgres` |
   | Connection mode | `session` |
   | Hostname | **Owner must supply the exact hostname. It is not recorded here; do not guess.** |
   | Port | `5432` |
   | Username | `postgres.nrnigsznectrgbgafwme` |
   | TLS | `sslmode=verify-full`; do not disable certificate or hostname verification |
   | Connection timeout | `connect_timeout=10` seconds (guard accepts 1–30 seconds) |

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
   project's Tools → Secrets/environment controls. Confirm that the Supabase
   URL and API-key claims identify only `nrnigsznectrgbgafwme`. Never copy
   values from the current Repl.
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
   preflight, then obtain separate approval for schema initialization and
   functional testing. The isolated database is currently uninitialized, so
   API health alone cannot enable login, catalog, cart, checkout, or order
   flows.
8. After App Storage is provisioned, verify private-document and
   delivery-photo authorization, product-image active-listing/vendor access,
   and branding responses. No remote storage verification has been performed.

The Customer Expo app must later receive the actual stable HTTPS API URL as
`EXPO_PUBLIC_API_URL`; its existing public Supabase URL and anon key must refer
to this same isolated project. Never put the service-role key or database URL
in the mobile app.

## Local checks

From the workspace root:

```sh
pnpm --filter @workspace/api run test:api-only
pnpm --filter @workspace/api run typecheck
pnpm --filter @workspace/api run build
```

These checks use local fakes and a loopback HTTP server. They do not connect to
Supabase, run migrations, or access remote storage.
