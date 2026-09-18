# Local Supermarket Marketplace

Phase 3 vendor/admin store-management foundation for the customer app, dashboard, Supabase database, and authentication.

## Run & Operate

- `pnpm --filter @workspace/api run dev` — run the API and Phase 3 management routes
- `pnpm --filter @workspace/customer run start` — run the Expo customer starter
- `pnpm --filter @workspace/dashboard run dev` — run the dashboard starter
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all workspace packages
- `pnpm --filter @workspace/db run generate` — generate a Drizzle migration from the database schema
- `pnpm --filter @workspace/db run check` — validate Drizzle migration consistency
- `pnpm --filter @workspace/db run migrate` — apply migrations to Supabase using `SUPABASE_DB_URL`
- `pnpm --filter @workspace/api run test` — run focused store-management validation and status tests

## Stack

- pnpm workspaces, Node.js, TypeScript
- Customer app: Expo + React Native + TypeScript
- Dashboard: React + Vite + TypeScript
- API: Express + TypeScript with Supabase Auth middleware
- Database: Supabase PostgreSQL + Drizzle ORM

## Where things live

- `apps/customer` — Expo starter app
- `apps/dashboard` — React dashboard with vendor/admin store-management controls
- `backend/api` — Express API with `GET /health`, Supabase Auth middleware, and store-management routes
- `lib/db` — Drizzle schema, config, and database access
- `packages/shared-types` — shared application role definitions
- `packages/validation` — Supabase configuration validation
- `packages/api-client` and `packages/constants` — reserved shared package foundations
- `database/migrations` — deterministic Drizzle migration files plus Supabase RLS SQL
- `docs` — phase documentation placeholders

## Architecture decisions

- Phase 1 intentionally uses pnpm workspaces because the provided project foundation already uses pnpm.
- Supabase credentials are required before applying migrations or exercising authenticated requests.
- Product catalog, customer discovery, carts, checkout, orders, payments, and delivery functionality remain deferred to later phases.

## Product

The marketplace product is not implemented yet. Phase 3 establishes vendor/admin store management only.

## User preferences

No additional preferences recorded.

## Gotchas

Do not add product, category, customer discovery, cart, checkout, order, payment, or delivery functionality before its designated phase.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
