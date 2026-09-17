# Local Supermarket Marketplace

Phase 1 repository foundation for the customer app, vendor/admin dashboard, and minimal API skeleton.

## Run & Operate

- `pnpm --filter @workspace/api run dev` — run the Phase 1 API skeleton
- `pnpm --filter @workspace/customer run start` — run the Expo customer starter
- `pnpm --filter @workspace/dashboard run dev` — run the dashboard starter
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all Phase 1 packages

## Stack

- pnpm workspaces, Node.js, TypeScript
- Customer app: Expo + React Native + TypeScript
- Dashboard: React + Vite + TypeScript
- API: Express + TypeScript

## Where things live

- `apps/customer` — Expo starter app
- `apps/dashboard` — React web starter
- `backend/api` — minimal Express API with `GET /health`
- `packages/*` — empty shared package foundations
- `database/migrations` — reserved for a later phase
- `docs` — phase documentation placeholders

## Architecture decisions

- Phase 1 intentionally uses pnpm workspaces because the provided project foundation already uses pnpm.
- Marketplace functionality is deferred to later phases.

## Product

The marketplace product is not implemented yet. Phase 1 only establishes the repository foundation.

## User preferences

No additional preferences recorded.

## Gotchas

Keep database, authentication, and marketplace work out of Phase 1.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
