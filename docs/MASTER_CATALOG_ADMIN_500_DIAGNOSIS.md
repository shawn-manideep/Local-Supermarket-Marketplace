# Admin Master Catalog HTTP 500 — Diagnosis and Focused Fix

## Exact failing request

`GET /api/admin/master-catalog/excel/history?page=1`

The existing `AdminCatalogExcelPanel` calls `loadHistory(1)` on mount, even before a workbook is downloaded or uploaded. Its error banner renders “Catalog request could not be completed” and the server's “Internal server error”.

Frontend: `apps/dashboard/src/AdminCatalogExcelPanel.tsx`, `loadHistory`.

Backend route: `backend/api/src/master-catalog/excel-routes.ts`, history GET handler behind `requireRole("admin")`.

Backend service: `backend/api/src/master-catalog/excel-service.ts`, `catalogHistory`.

## Proven causes

### 1. Database schema dependency had never been applied

The history service reads `public.catalog_import_events`, including its row count, newest import and import-history page.

Reproducing the service with the configured backend database connection produced:

```text
PostgreSQL code: 42P01
relation "catalog_import_events" does not exist
```

Read-only schema inspection returned `to_regclass('public.catalog_import_events') = NULL`. Supabase migration history contained the store-location migration but not `0016_catalog_excel_import_history`, although that migration and the schema model already existed in the codebase.

Authenticated HTTP reproduction confirmed:

| Request | Before fix |
|---|---:|
| `/api/admin/master-catalog/excel/history?page=1` | 500 |
| `/api/admin/master-products?status=active&page=1&pageSize=20` | 200 |
| `/api/admin/master-categories` | 200 |

This isolates the failure to Excel history metadata, not the core category/product APIs, missing authentication, Admin permission, incorrect API URL or general database connectivity.

### 2. Raw SQL timestamp was incorrectly treated as a Date

After applying the missing table migration, the history request still returned 500. Direct reproduction then exposed:

```text
TypeError: lastUpdated?.toISOString is not a function
    at catalogHistory (.../master-catalog/excel-service.ts)
```

The `greatest(max(master_categories.updated_at), max(master_products.updated_at))` result from `database.execute` arrives as timestamp text. A TypeScript generic declaring `Date` does not convert the runtime value. The service called `.toISOString()` and would also call `.getTime()` for importer attribution when import history exists.

Classification: **database/migration mismatch plus backend response serialization**.

## Recent changes assessed

- **Shared UI design system:** not the cause. The UI successfully renders and correctly reports the API failure. No styling or layout changes were needed.
- **Excel implementation:** the direct dependency. Its mount-time history request depends on the unapplied audit-table migration and contains the timestamp assumption. These defects existed in that implementation; this investigation did not introduce them.
- **Migration 0017:** not the cause. It only adds physical store-profile columns and a postcode check to `public.stores`; `catalogHistory` queries canonical master tables, catalog import events and Admin labels. No store-location dependency was found.
- **Catalog reset:** did not delete the audit table. The table was never registered/applied, and the reset's allowlisted maintenance SQL contains only master lifecycle updates.
- **Authentication/configuration:** Admin authentication succeeded for the failing request, and both canonical Admin reads returned 200 with the same session. The relevant database/auth configuration was present.

Initial workflow logs showed repeated “Unhandled request error”. The error middleware intentionally emits only this generic message when `NODE_ENV` is not `development`; it did not retain the actual cause in those lines. The exact exceptions above were captured by read-only invocation of the same service using the running backend's existing database configuration, and the HTTP failure was independently reproduced through the development proxy.

## Targeted fixes only

1. Applied the existing, previously unapplied `database/migrations/0016_catalog_excel_import_history.sql` to the established **development** Supabase project through its migration-history mechanism.
   - Created the existing planned `catalog_import_events` audit table and serial sequence.
   - Enabled its existing migration's RLS and backend-only grants.
   - Registered the applied migration without editing or replaying any prior migration.
   - No rows were inserted into the new audit table; history correctly starts empty.
2. Updated `backend/api/src/master-catalog/excel-service.ts` to normalize raw SQL timestamp text to a Date before comparison/ISO serialization, while preserving already-mapped Dates and null.
3. Added `backend/api/src/master-catalog/catalog-history.test.ts` with two focused timestamp regression tests.

No UI files, authentication code, upload/apply workflow, canonical fields, vendor operations, order code or delivery code were changed. The existing migration source file was applied **unchanged**, not edited.

Additional deliverable files:

- `docs/MASTER_CATALOG_ADMIN_500_DIAGNOSIS.md`
- `docs/MASTER_CATALOG_ADMIN_500_PRESERVATION.json`

## Verification

- Authenticated Admin history request after both fixes: **HTTP 200**, empty history, valid ISO `lastUpdated`, current canonical counts, `updatedBy: null` when no matching importer exists.
- Anonymous history request: **HTTP 401**, “Authentication required”.
- Focused history/routes/validation tests: **14 passed, 0 failed**.
- API typecheck: passed.
- API workflow restarted successfully; `/api/health`: HTTP 200.
- Live Vendor denial check could not complete because the available QA Vendor sign-in attempt failed. No credentials/accounts were reset or changed to overcome this. This limitation does not affect the successful authenticated Admin verification; existing Admin-role middleware was unchanged.
- No automated browser testing, catalog upload/apply, deployment or unrelated feature work.

## Data protection and concurrent activity

Before/after full-row fingerprints surrounding the schema application were identical for all 20 existing protected commercial/account/history tables, including:

- Store-owned products and categories; prices, stock, availability, SKU and selling configuration.
- Product variants.
- Carts and cart items.
- Orders, order items and order-status history.
- Customer repeat requests.
- Delivery assignments and delivery-partner profiles.
- Stores, operating hours and delivery service postcodes.
- Profiles, customers, addresses, usernames, master mapping audit and platform management events.

Existing master categories also had an identical fingerprint at that comparison.

**Concurrency caveat:** master product counts changed from 210 to 211 between the two snapshots, and later requests observed further live catalog authoring. The newly added row's creation timestamp coincided with the investigation. The schema migration only creates the audit table/sequence and grants; this agent issued no INSERT/UPDATE/DELETE against master products or categories in this task. Do not misrepresent all catalog fingerprints as identical or attribute independent catalog authoring to this fix. The evidence JSON retains the actual before/after comparison.

Normal test-account sign-in was used for authenticated API reads; no account creation, password change or authentication migration was performed.

## Manual confirmation

Refresh Admin → Master Catalog. The history/version section should load without the error banner. An empty import history is expected because no catalog import has yet been applied. Existing category/product authoring should continue to work as before.

Stopped after the proven diagnosis and minimal fixes.
