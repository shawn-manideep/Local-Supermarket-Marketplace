v0.1.0 — initial repository structure
v0.2.0 — Supabase database, authentication foundation, migrations, and RLS
v0.3.0 — vendor/admin store management, service pincodes, operating hours, and commission controls
v0.4.0 — store-owned category/product management, catalog lifecycle controls, validation, and vendor dashboard
v0.5.0 — customer Expo authentication shell, profile management, reusable addresses, and protected customer APIs
v0.6.0 — pincode-based ACTIVE store discovery, customer catalog browsing, operating status, and product detail
v0.7.0 — persistent one-store cart, stock-aware quantities, explicit store switching, and COD checkout validation
v0.8.0 — customer order creation/list/detail/cancellation, vendor-scoped order lifecycle actions, transactionally locked cart conversion, current-value revalidation, immutable snapshots, bigint-cent half-up commission calculation with explicit 0.00% fallback, vendor_staff delivery foundation, COD unpaid-at-placement behavior, and migration 0003 history/identity hardening
v0.9.0 — vendor-owned bounded order operations with paginated status counts, detail and legal lifecycle actions with stale `409` refresh behavior, read-only admin platform order list/detail with status/store/date filters and scoped counts, and admin-only commission snapshots; no migration, realtime, or stock deduction
v0.10.0 — Phase 10 vendor-owned delivery using the existing vendor action API for `READY` → `OUT_FOR_DELIVERY` → `DELIVERED`, vendor delivery queue filters, customer-friendly Vendor Delivery status visibility, admin delivery visibility, immutable delivery/contact/address/fee/total snapshots, existing stale/duplicate locking, and COD/vendor_staff MVP; no migration, new delivery endpoint, GPS/maps, partners/agents, realtime, notifications, payment, or stock changes

v0.11.0 — Phase 11 security and reliability hardening: dependency-free
trusted-proxy API limits of 300 reads/minute, 60 mutations/minute, and 10
order creations/minute per client IP; 100 KB JSON parsing with safe 413/429
responses; production-safe unhandled errors; singleton Supabase verification
and role-error propagation; maximum 100 list caps; 366-day admin date windows;
deterministic customer order sorting; marketplace-hours N+1 removal; frontend
duplicate/stale request guards and accessibility labels; and 33 tests.
Forward-only migration 0004 revokes unnecessary function privileges, protects
store identities, enforces cart privacy, and adds order indexes; approved
migration 0003 is unchanged. SAST and HoundDog found 0 findings, with no
hardcoded secrets. Dependency scan limitation: the same seven transitive
Expo/Metro build-tool findings involving image-size, postcss, and uuid are
classified as 5 high/2 moderate by Replit's scanner and 4 high/3 moderate by
`pnpm audit`; no untrusted CSS/image upload processing exists, and no
major/toolchain override was applied without compatibility evidence. Authenticated
role/IDOR/RLS/migration/concurrency live tests remain blocked without
development Supabase credentials and fixtures. No Phase 12, deployment, or
production changes; this does not claim production readiness.