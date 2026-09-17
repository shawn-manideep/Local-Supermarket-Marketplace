# Local Supermarket Marketplace

Phase 2 infrastructure foundation for the customer app, vendor/admin dashboard, Supabase database, and authentication.

## Run & Operate

- `pnpm --filter @workspace/api run dev` — run the Phase 1 API skeleton
- `pnpm --filter @workspace/customer run start` — run the Expo customer starter
- `pnpm --filter @workspace/dashboard run dev` — run the dashboard starter
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all Phase 1 packages
- `pnpm --filter @workspace/db run generate` — generate a Drizzle migration from the database schema
- `pnpm --filter @workspace/db run check` — validate Drizzle migration consistency
- `pnpm --filter @workspace/db run migrate` — apply migrations to Supabase using `SUPABASE_DB_URL`

## Stack

- pnpm workspaces, Node.js, TypeScript
- Customer app: Expo + React Native + TypeScript
- Dashboard: React + Vite + TypeScript
- API: Express + TypeScript with Supabase Auth middleware
- Database: Supabase PostgreSQL + Drizzle ORM

## Where things live

- `apps/customer` — Expo starter app
- `apps/dashboard` — React web starter
- `backend/api` — Express API with `GET /health` and reusable Supabase Auth middleware
- `lib/db` — Drizzle schema, config, and database access
- `packages/shared-types` — shared application role definitions
- `packages/validation` — Supabase configuration validation
- `packages/api-client` and `packages/constants` — reserved shared package foundations
- `database/migrations` — deterministic Drizzle migration files plus Supabase RLS SQL
- `docs` — phase documentation placeholders

## Architecture decisions

- Phase 1 intentionally uses pnpm workspaces because the provided project foundation already uses pnpm.
- Supabase credentials are required before applying migrations or exercising authenticated requests.
- Marketplace functionality is deferred to later phases.

## Product

The marketplace product is not implemented yet. Phase 2 establishes database and authentication infrastructure only.

## User preferences

No additional preferences recorded.

## Gotchas

Do not add marketplace UI or business endpoints until the infrastructure phase is reviewed.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
