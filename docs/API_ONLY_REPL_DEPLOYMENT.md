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
wrapper—is the source of truth. Replit's artifact registry is project-scoped,
and publishing the current project is not an API-only operation.

For the first setup, use the full repository checkout on the approved branch:
the frozen workspace lockfile includes all workspace importers. Build and start
only `@workspace/api`. The new Replit project must be checked before publishing
to ensure its artifact registry contains no Customer, Dashboard, or other
portal services. If import auto-registers those artifacts, stop and resolve
that project setup rather than publishing them. Do not prune the source tree
against the existing lockfile or fork a second API implementation.

## Commands

Run from the repository/workspace root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api run build
pnpm --filter @workspace/api run start:api-only
```

The Replit service must use the same build and start commands. Replit supplies
`PORT`; the API binds to `0.0.0.0`. The ordinary `start` script and
`backend/api/src/index.ts` remain the existing path. `start:api-only` validates
the isolated target before it dynamically loads the shared API app.

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
rolls back. Each query has a five-second client timeout; a failed connection or
check prevents the API app from loading/listening. This read-only preflight is
implemented only in `start:api-only` and was not run against Supabase here.
It never prints values. JWT claim checks are a configuration mismatch guard,
not signature verification; Supabase verifies tokens when requests are made.

The current `lib/db` pool uses the connection string and has no explicit
statement/query timeout. This change does not alter pool or TLS options.
Connection timeout is bounded by the validated connection-string setting;
the API-only startup identity query has a per-query timeout, but ordinary
application queries do not.

## Storage and access boundaries

Unset `API_OBJECT_STORAGE_PROVIDER` continues to use the current Replit GCS
sidecar implementation. Only the exact value `replit-app-storage` enables the
new SDK adapter; an unknown value fails rather than switching providers.
Replit App Storage credentials are supplied by the SDK/project integration,
not by copying the existing sidecar credentials. Each Replit project owns its
own bucket; begin with the new project's empty bucket and do not copy old
objects.

The SDK does not expose the existing GCS content metadata/generation fields.
Product-image MIME types are stored in companion metadata objects. Branding
uses versioned image objects and an active manifest so a failed manifest
replacement does not replace the current image. Vendor documents and
delivery-partner photos stay under separate `private/` namespaces. Their
existing authenticated API routes remain the only read path. Product and
branding images also remain API-mediated; no object URL or public bucket
access is added. Existing GCS code remains the default.

## Deployment and verification sequence (not performed)

1. Create a separate Replit project connected to the approved source branch;
   verify it has only the API service registered, and that the existing portal
   project remains untouched.
2. Confirm the exact new-project Supabase API key format and owner-provided DB
   host, username, port, and connection mode. The code intentionally refuses
   unconfirmed values. The prior direct endpoint was confirmed, but direct
   connectivity previously failed in this environment; no pooler values are
   known here.
3. Add the listed API-only Secrets/configuration to the separate project.
   Confirm `SUPABASE_URL` and both API-key claims identify only
   `nrnigsznectrgbgafwme`. Do not reuse Secrets from the current Repl.
4. Build and start the API service. Before publishing, validate startup
   configuration and run the local checks below.
5. After a separately approved publish, use the generated HTTPS URL (do not
   invent one) for `GET /health` and `GET /api/health`, for example with
   `curl -i "https://<generated-API-origin>/health"`. These are process
   liveness checks only; they do not prove database, Auth, or storage
   readiness.
6. Perform a separately authorized read-only Supabase identity/schema
   preflight, then authorize schema initialization and functional testing as
   distinct steps. The isolated database is currently uninitialized, so API
   health alone cannot enable login, catalog, cart, checkout, or order flows.
7. Verify private-document and delivery-photo authorization, product-image
   active-listing/vendor access, and branding's API response after the new
   bucket is available. No remote storage verification has been performed.

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
