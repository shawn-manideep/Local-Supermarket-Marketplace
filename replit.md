# Local Supermarket Marketplace

Phase 4 vendor catalog-management foundation for the customer app, dashboard, Supabase database, and authentication.

## Run & Operate

- `pnpm --filter @workspace/api run dev` — run the Phase 3/4 management API
- `pnpm --filter @workspace/customer run start` — run the Expo customer starter
- `pnpm --filter @workspace/dashboard run dev` — run the dashboard starter
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all workspace packages
- `pnpm --filter @workspace/db run generate` — generate a Drizzle migration from the database schema
- `pnpm --filter @workspace/db run check` — validate Drizzle migration consistency
- `pnpm --filter @workspace/db run migrate` — apply migrations to Supabase using `SUPABASE_DB_URL`
- `pnpm --filter @workspace/api run test` — run focused store/catalog HTTP and validation tests

## Stack

- pnpm workspaces, Node.js, TypeScript
- Customer app: Expo + React Native + TypeScript
- Dashboard: React + Vite + TypeScript
- API: Express + TypeScript with Supabase Auth middleware
- Database: Supabase PostgreSQL + Drizzle ORM

## Where things live

- `apps/customer` — Expo starter app
- `apps/dashboard` — React dashboard with vendor catalog and vendor/admin store controls
- `backend/api` — Express API with health, Supabase Auth, store, category, and product management
- `lib/db` — Drizzle schema, config, and database access
- `packages/shared-types` — shared application role definitions
- `packages/validation` — Supabase, store, category, and product validation
- `packages/api-client` and `packages/constants` — reserved shared package foundations
- `database/migrations` — deterministic Drizzle migration files plus Supabase RLS SQL
- `docs` — phase documentation placeholders

## Architecture decisions

- Phase 1 intentionally uses pnpm workspaces because the provided project foundation already uses pnpm.
- Supabase credentials are required before applying migrations or exercising authenticated requests.
- Customer discovery/catalog, search, carts, checkout, orders, payments, and delivery remain deferred to later phases.

## Product

The customer marketplace is not implemented yet. Phase 4 establishes vendor-owned category and product management only.

## User preferences

No additional preferences recorded.

## Gotchas

Do not add customer catalog/discovery, search, cart, checkout, order, payment, or delivery functionality before its designated phase.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
