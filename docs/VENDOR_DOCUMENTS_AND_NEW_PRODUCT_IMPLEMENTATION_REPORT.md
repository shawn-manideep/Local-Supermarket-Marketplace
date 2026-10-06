# Vendor Documents and New Product Implementation Report

## Outcome and approved policy

Implemented in the existing Marketplace Dashboard and API. Supabase remains the
identity/database provider; no new authentication architecture, product tables,
or global catalog architecture was introduced.

**User clarification: the mandatory-document gate applies to NEW Vendors only.**
All three existing stores retain catalog access regardless of document completion.
They can still use the Documents page. Stores created after the development
migration inherit the mandatory-document requirement.

No deployment or automated browser tests were performed.

## Functionality

### Vendor search

Search Products and Browse by Category now share equal-width grid tracks, 44px
height, padding, border, and radius. At tablet/mobile widths they stack at full
width. Existing search/filter handlers, debounce, pagination, and API behavior
were not changed.

### Documents

The Vendor sidebar includes Documents. New Vendors with incomplete documents
land there on login. Catalog navigation is redirected there while incomplete;
Orders, Store Profile, account settings and logout remain outside the gate.

Mandatory documents, exactly four:

1. FSSAI License
2. Aadhaar Card
3. PAN Card
4. Photo

Optional documents, exactly three:

1. GST
2. Trade License
3. Labour License

The page displays mandatory completion out of four and optional completion out
of three, upload/replacement controls, filename/version information, and secure
View actions. Required-account messages are:

- `Complete your document verification before managing your catalog.`
- `Your mandatory documents are complete. You can now manage your catalog.`

Existing Vendors see an exemption explanation; their incomplete documents do
not block their catalogs. No Admin approval is required to unlock new accounts:
four successful mandatory uploads are sufficient.

### Storage, validation, privacy and replacement

Inspection found no existing document model and no Supabase storage buckets.
Provisioned Replit App Storage and used its **private** directory. The existing
Supabase bearer authentication protects upload/read APIs; no Replit Auth
migration was made.

- Files are stored privately; PostgreSQL stores metadata/references, not bytes.
- Raw uploads are authenticated and associated with the server-resolved store.
- Formats: PDF, JPG/JPEG and PNG; maximum **5 MiB** per file.
- The backend checks type/extension agreement, nonempty size, filename safety,
  file signatures and format boundaries. These are practical corruption checks,
  not a full PDF/image decoder or a malware/content authenticity scanner.
- Metadata includes store, type, private reference, original filename, MIME,
  size, upload/update timestamps, version and current status.
- No storage reference or provider URL is returned to the browser.
- View fetches authenticated bytes and opens a temporary browser Blob URL.
- Responses use private/no-store caching; content uses `nosniff` and sandbox CSP.
- Replacement uploads new private bytes first, then serializes version/current
  metadata updates in one transaction under a store row lock.
- Failed replacement leaves the current valid document intact. Failed metadata
  commit attempts cleanup of the newly uploaded object.
- Prior metadata and files are retained as lightweight history; only the current
  version is exposed by the Vendor viewing endpoint.
- There is no document deletion endpoint or normal Delete control, including
  optional documents. Optional removal was deliberately not added.
- Other Vendors and Customers cannot view a Vendor's documents.
- Admin document review/access UI was not added.
- Supabase public clients cannot read/write private document metadata. Verified
  that authenticated clients also cannot update the onboarding gate column.

### Server-side catalog gate

Reusable document status/authorization checks protect supported POST, PATCH and
PUT catalog mutations: local-product creation, edits, prices, stock,
availability, activation, categories, individual variants, and variant batches.
Master Catalog selection/add-to-store has the same check.

Incomplete new Vendors receive HTTP 403 with code `VENDOR_DOCUMENTS_REQUIRED`
before a catalog write. Browser navigation alone is not the security boundary.
Reads remain store-scoped. Nonexistent hard-delete routes still return 404.
Existing products are not deleted or modified by onboarding.

### Product creation and duplicate review

`+ Add Product` offers:

- **Select from Master Catalog** — preserves the existing selection flow and
  independent Vendor selling-option configuration.
- **Add New Product** — creates a store-local record in the existing `products`
  and `product_variants` models.

The local form captures name, brand, description, optional image URL, category,
SKU/external code, availability, selling quantities/units, variant prices and
stock. It requires selling variants with valid quantities and positive active
prices.

Duplicate checking reuses Master Catalog matching, normalization, canonical
identity and write serialization. Store category mappings are respected. Exact
candidates are prioritized before limiting candidate results.

- Similar matches display `Similar product found in Master Catalog.`
- Use Existing Product invokes the original add-to-store endpoint.
- Continue with New Product requires explicit similarity confirmation.
- Exact Master identity matches cannot be bypassed with `confirmSimilar=true`.
- Same-store duplicate local identities and conflicting SKU/external-code
  constraints return conflicts rather than creating partial records.
- Matching and creation are rechecked server-side inside the transaction.
- Name/brand matches are treated conservatively when classification is unknown;
  the form does not manufacture canonical attributes to avoid a match.

The missing-category request is captured as `requested_category_name` on the
listing. Existing category selection and a missing-category request are mutually
exclusive. It creates **no** global category or separate request/mapping system.
Store-local records remain compatible with the existing Admin mapping-correction
endpoint, using the stable listing ID; no automatic review queue or publishing
approval was introduced.

New records have `master_product_id = NULL` and the authenticated Vendor's store
ID. Vendor B cannot fetch or list Vendor A's record. Vendor commercial values do
not modify Master Catalog data.

The existing Customer discovery, cart and checkout-validation APIs accept
eligible active local products and their current selling variants without code
changes to those flows.

## Migration and database preservation

Applied **development only**:

`database/migrations/0019_vendor_documents_and_local_products.sql`

- Adds `stores.documents_required`: existing values are false; default for new
  inserts is true.
- Adds local-product `brand` and `requested_category_name`.
- Adds private `vendor_documents`, version/current constraints and RLS.
- Revokes public/anonymous/authenticated document table access.
- No approved prior migration was modified.

Development counts immediately before and after migration:

| Records | Before | After |
|---|---:|---:|
| Stores | 3 | 3 |
| Products | 44 | 44 |
| Variants | 91 | 91 |
| Master Products | 364 | 364 |
| Orders | 26 | 26 |
| Order items | 43 | 43 |

Separate read-back confirmed **0 of the 3 existing stores are gated**. Counts
are preservation evidence, not a claim that every live row was content-hashed.
The isolated integration tests additionally compare protected original product
and variant contents before/after the changed flows.

No production migration, catalog cleanup, seed, order operation or real
customer checkout was performed.

## Files changed

### Frontend

- `apps/dashboard/src/VendorStorePanel.tsx`
- `apps/dashboard/src/CatalogManagementPanel.tsx`
- `apps/dashboard/src/VendorDocumentsPanel.tsx` — new
- `apps/dashboard/src/VendorNewProductPanel.tsx` — new
- `apps/dashboard/src/index.css`

`VendorMasterCatalogPanel.tsx` handlers/source did not need changes; its control
layout is corrected through scoped CSS.

### Backend, schema and dependencies

- `backend/api/src/app.ts`
- `backend/api/src/catalog-management/routes.ts`
- `backend/api/src/catalog-management/local-products.ts` — new
- `backend/api/src/master-catalog/routes.ts`
- `backend/api/src/vendor-documents/files.ts` — new
- `backend/api/src/vendor-documents/storage.ts` — new
- `backend/api/src/vendor-documents/service.ts` — new
- `backend/api/src/vendor-documents/routes.ts` — new
- `backend/api/src/vendor-documents/vendor-documents.integration.test.ts` — new
- `backend/api/src/vendor-documents/ui-contracts.test.ts` — new
- `backend/api/package.json` — storage dependency and focused test command
- `pnpm-lock.yaml`
- `lib/db/src/schema/index.ts`
- `database/migrations/0019_vendor_documents_and_local_products.sql` — new

### API contracts/generated files

- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/index.ts` — explicitly disambiguates Orval path/query exports
- New files in `lib/api-zod/src/generated/types/`:
  `getVendorProductMatchesParams.ts`, `uploadVendorDocumentParams.ts`,
  `vendorCurrentDocument.ts`, `vendorCurrentDocumentMimeType.ts`,
  `vendorDocumentStatus.ts`, `vendorDocumentSummary.ts`, `vendorDocumentType.ts`,
  `vendorLocalProductCreate.ts`, `vendorLocalProductResponse.ts`,
  `vendorLocalProductResponseProduct.ts`,
  `vendorLocalProductResponseProductVariantsItem.ts`,
  `vendorLocalVariantInput.ts`, `vendorLocalVariantInputQuantityUnit.ts`,
  `vendorProductMatch.ts`, `vendorProductMatchesResponse.ts`.

Project memory was updated to retain the user-approved new-Vendor-only policy
and distinguish approved store-local product creation from Admin-only global
Master Catalog authoring.

Documentation/memory files:

- `docs/VENDOR_DOCUMENTS_AND_NEW_PRODUCT_IMPLEMENTATION_REPORT.md` — new
- `.agents/memory/MEMORY.md`
- `.agents/memory/master-catalog-ownership.md`
- `.agents/memory/pending-master-classification.md`
- `.agents/memory/vendor-document-onboarding.md` — new
- `.agents/memory/router-mount-boundaries.md` — new

## APIs

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/vendor/documents` | Own document metadata and gate/completion status |
| PUT | `/api/vendor/documents/:type?fileName=...` | Authenticated raw file upload/replacement |
| GET | `/api/vendor/documents/:id/content` | Authenticated own-current-document bytes |
| GET | `/api/vendor/product-matches?name=...&brand=...&categoryId=...` | Reused Master matching |
| POST | `/api/vendor/products` | Restored endpoint for atomic store-local creation |

Existing Master Catalog add-to-store and catalog update APIs are retained with
the new gate where applicable. No Customer, cart, checkout, order, stock
deduction, Delivery Partner or historical-order source files were changed.

## Verification results

### Final focused tests: PASS — 118 passed, 0 failed, 0 skipped

Exact final command:

```sh
pnpm --filter @workspace/api exec tsx --test \
  src/vendor-documents/*.test.ts \
  src/catalog-management/routes.test.ts \
  src/catalog-management/validation.test.ts \
  src/master-catalog/duplicate-review.test.ts \
  src/customer-cart/cart.test.ts \
  src/orders/orders.test.ts \
  src/orders/inventory-contracts.test.ts \
  src/orders/reorder.test.ts \
  src/orders/vendor-management.test.ts \
  src/delivery-partner/foundation.test.ts \
  src/delivery-partner/workflow.contract.test.ts
```

Changed-flow coverage includes: old/new exemption, mandatory 0/3/4 completion,
optional non-unlocking, exact types/messages, gate on direct parent/child/batch
writes, invalid files, failed storage replacement, version retention, private
view access, direct database denial, duplicate checks, atomic rollback on variant
SKU conflict, foreign category/store injection, store isolation, Master
selection/configuration/activation, current-price local variants, Customer
discovery/cart/checkout validation, no order creation or stock deduction from
cart/validation, preserved original stock, and frontend source/CSS contracts.

The isolated PostgreSQL fixture uses all migrations and real HTTP routes,
database transactions, constraints and RLS. Only the external identity provider
and document-byte provider are simulated. A separate real App Storage check
successfully uploaded/read back synthetic bytes and removed the temporary file.
No real Vendor documents were used for testing.

Initial checks caught and fixed a nested-route gate match and preservation of
nonexistent DELETE-route behavior. Fixture/schema/source-test setup issues were
also corrected. The final test run has no failures. Its deliberate provider
failure case emits an expected generic server error while asserting preservation.

### Build/runtime checks

| Check | Result |
|---|---|
| OpenAPI generation | Generated successfully; path/query export collision resolved |
| `pnpm -w run typecheck:libs` | PASS |
| `pnpm --filter @workspace/api run typecheck` | PASS |
| `pnpm --filter @workspace/dashboard build` | PASS |
| `pnpm --filter @workspace/dashboard typecheck` | BLOCKED by the same 97 pre-existing errors |
| Real private-storage synthetic upload/read-back/cleanup | PASS |
| API/Dashboard managed workflow restart | PASS; both running |
| Passive unsigned-in Dashboard screenshot | Sign-in page renders |

The 97 existing errors are confined to `src/admin.test.tsx`,
`src/delivery-partner.test.tsx`, `src/vendor-orders.test.tsx`, and
`vite.config.ts`. No changed frontend file reports a type error. They were not
fixed. The passive screenshot cannot inspect authenticated Vendor screens and
reported one unspecified missing-resource 404; it does not constitute manual
acceptance of the changed Vendor UI. No automated browser interactions were run.

## Manual acceptance checklist — not yet executed

Use a newly provisioned development Vendor A and a separate Vendor B, plus an
existing Vendor to verify the exemption. Use appropriate synthetic/test files.

1. **New Vendor first login:** With no documents, sign in and confirm Documents
   opens. Check 0/4 mandatory and 0/3 optional.
2. **Gate:** Try Catalog and direct catalog mutation requests. Confirm redirect
   to Documents / HTTP 403. Confirm Orders, Profile, Settings and logout work.
3. **Mandatory uploads:** Upload FSSAI License, Aadhaar Card, PAN Card and Photo.
   At 3/4 remain blocked; at 4/4 show the exact completion message. Invalid,
   empty, corrupt-signature, mismatched-type and oversized files must fail.
4. **Unlocked catalog/exemption:** Open Catalog after completion. Confirm an
   existing Vendor can open Catalog without documents. Optional uploads must
   never be needed for either account's catalog access.
5. **Existing Master selection:** Choose Select from Master Catalog, search and
   browse categories, add a product, configure price/stock/units and publish.
   Check search/category controls have matching dimensions on desktop and stack
   cleanly on mobile/tablet.
6. **New product flow/review:** Choose Add New Product. Check name/brand/category
   matching. Use Existing Product for an exact candidate. For a merely similar
   candidate, explicitly Continue with New Product. Capture a missing-category
   request without creating a global category.
7. **Create store-local listing:** Enter valid selling variants and save.
   Confirm Vendor price, stock, availability, image/description and listing
   identity read back; no Master Product or Master Category is created.
8. **Vendor B/privacy:** Confirm Vendor B cannot fetch/list Vendor A's listing
   or view A's documents. Customer/anonymous document access must be denied.
   Reject foreign category/store IDs without changing any record.
9. **Replacement:** View and replace a document. Confirm new filename/version,
   retained 4/4 completion and no Delete control. Simulate upload failure and
   confirm the previously current document still works.
10. **Customer/regressions:** With an eligible saved address, confirm the new
    active product and variants appear and use current Vendor prices in cart
    and checkout validation. Check ordinary existing Orders/stock transitions,
    cart, checkout and Delivery Partner operations remain as previously accepted.

Manual UI acceptance is intentionally left explicit rather than claimed as
passed. Implementation and focused verification are complete; no deployment or
additional scope was started.
