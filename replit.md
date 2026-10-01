# Local Supermarket Marketplace

Customer marketplace, vendor/admin dashboard, Supabase-backed commerce, and Master Catalog foundation.

## Run & Operate

- `pnpm --filter @workspace/api run dev` — run the Phase 3/4 management API
- `pnpm --filter @workspace/customer run start` — run the Expo customer starter
- `pnpm --filter @workspace/dashboard run dev` — run the dashboard starter
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all workspace packages
- `pnpm --filter @workspace/db run generate` — generate a Drizzle migration from the database schema
- `pnpm --filter @workspace/db run check` — validate Drizzle migration consistency
- Migration application — follow the target-specific procedure in [Supabase migration history](.agents/memory/supabase-migration-history.md).
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
- Master Catalog extends existing store-owned products and variants; it never replaces commerce identities or historical snapshots.
- Master changes use additive migrations, explicit vendor selection, and store-specific selling configuration. No synthetic default variant is created for new master selections.

## Product

The customer marketplace supports store discovery, catalog browsing, cart/checkout, COD orders, and repeat orders. Master Catalog adds canonical product management and global discovery while purchasing remains store-specific.

## User preferences

No additional preferences recorded.

## Gotchas

Do not redesign authentication, checkout, orders, or repeat orders in the Master Catalog phase. Stock reservation/deduction, payment gateways, and Delivery Partner remain out of scope.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
