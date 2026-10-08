# Admin Vendor Document Viewing — implementation report

## Scope and result

Added a read-only **Vendor Documents** section to:

**Admin → Vendors → select Vendor → Vendor Details**

Authorized Admins can see mandatory/optional upload status, completion counts, filenames, uploaded/updated dates and current versions, and securely open uploaded files. There are no document approval/rejection, upload, deletion or verification-state controls.

The existing Vendor document model, private storage adapter, upload/replacement routes and completion calculation are reused. No second table, storage system or migration was introduced. No deployment or automated browser tests were run.

## Existing architecture reused

- `vendor_documents` stores metadata, private object references, versions and `is_current`.
- The existing private `documentStorage` adapter stores and reads file bytes. Object references remain server-side.
- `documentStatus(storeId)` remains the authoritative document-type list and completion calculation: four mandatory documents and three optional documents.
- Existing Vendor upload commits a new version and marks the previous version non-current transactionally. That upload transaction and failure cleanup are unchanged.
- Existing private byte-view behavior was extracted into a shared helper used by both Vendor and Admin routes, rather than copied.
- Added `updatedAt` to existing returned metadata and its shared contract; this is an additive field, not a new document/status model.

Existing upload types remain **PDF, JPEG and PNG**. The Admin browser preview permits PDF/JPEG/PNG/WebP responses, but this task does not enable new Vendor upload formats or change existing validation/storage restrictions.

## API changes and authorization

### `GET /api/admin/vendors/:vendorId/documents`

Returns the existing `VendorDocumentStatus` shape for the selected Vendor.

- Requires authenticated `admin` role server-side.
- `vendorId` is the **Vendor account/user UUID**, not a caller-provided store UUID.
- Resolves the linked store through `user_profiles` and `stores`, requiring that the selected account has Vendor role.
- Uses the existing store-scoped metadata/completion service.
- Returns only current documents for that store, with no object references or permanent URLs.
- Uses `Cache-Control: private, no-store`.

### `GET /api/admin/vendors/:vendorId/documents/:documentId/content`

Returns authenticated current-file bytes.

- Enforces Admin role independently on the nested content route.
- Resolves the requested Vendor's store before reading the document.
- Requires document ID, resolved store ID and `is_current` to match together.
- Wrong Vendor/document combinations, obsolete versions and unknown selectors return 404.
- Reuses the private storage adapter and the shared current-document byte reader.

Responses preserve the existing inline filename, actual MIME type, `private, no-store`, `nosniff` and sandbox headers.

Existing routes remain available:

- `GET /api/vendor/documents`
- `PUT /api/vendor/documents/:type`
- `GET /api/vendor/documents/:id/content`

Their ownership, upload validation, catalog gate and replacement semantics remain intact. Existing Vendors retain their established catalog exemption.

## Storage and viewing security

- No private storage policy or namespace was changed.
- No document was made public; no permanent public URL is generated.
- JSON metadata excludes private paths.
- The UI uses the existing authenticated JSON client and same-origin credentials for binary requests, preserving development-preview cookies separately from the bearer header.
- View opens an ephemeral browser Blob URL after an authenticated byte response. The new window has no opener.
- The preview accepts only the supported image/PDF MIME whitelist.
- Popup/request/Blob resources are closed, aborted or revoked on dismissal, failures and component teardown.
- No document bytes or URLs are persisted in local/session storage.
- Pop-up blockers produce an actionable error rather than silently failing.

## Admin UI and responsive behavior

The section is mounted only for Vendor details, keyed by Vendor account ID to prevent stale state carrying across selections.

- **Mandatory Documents:** `X/4 Complete` or `X/4 Incomplete`.
- **Optional Documents:** separate uploaded count and statuses; optional uploads never inflate mandatory completion.
- All seven existing document types show **Uploaded** or **Not uploaded**.
- Uploaded records show filename, upload date, current version and update date when supplied.
- View is available only when there is a current document.
- Internal IDs are used only for authenticated requests, not displayed as metadata.
- Explicit Refresh/Retry, loading and error states are provided.
- Metadata reloads on mount/reopen, browser focus/visibility return and Refresh.
- Stale View requests returning 404 refresh metadata and ask the Admin to review the updated version; an obsolete file is not silently substituted.
- On phone widths through 420px, document rows and actions stack vertically, long filenames wrap and View has a full-width 44px touch target. Existing desktop styling is retained.

Completion is derived from `mandatoryCount`, **not** `canManageCatalog`: a grandfathered Vendor with catalog access can still correctly display incomplete uploads. Completion is informational and does not approve, reject, suspend or otherwise update the Vendor.

The optional Vendor-directory indicator was not added: the current directory does not already carry document counts, and adding per-row requests or changing directory queries is unnecessary for the required details integration.

## Replacement behavior

Admin metadata queries only `is_current` rows. After Vendor replacement:

1. The existing upload route retains the old history row and creates the next current version.
2. Admin refresh/reopen/focus retrieves the new filename, version and timestamps.
3. A newly attempted View of an obsolete ID returns 404.
4. Admin and Vendor can view the new current bytes through their respective authorized routes.

Already-fetched bytes cannot be retroactively withdrawn from a user's browser. The implementation prevents new reads of obsolete versions and cleans up application-created preview resources.

## Files changed

### Backend

- `backend/api/src/vendor-documents/content.ts` — shared private current-file byte reader.
- `backend/api/src/vendor-documents/routes.ts` — Admin-only read routes; existing Vendor content route delegates to the shared reader.
- `backend/api/src/vendor-documents/service.ts` — Vendor-account-to-store resolution and additive update timestamp.

### Contracts/generated code

- `lib/api-spec/openapi.yaml` — two Admin read contracts and optional update timestamp.
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`

Generated files were regenerated through the existing OpenAPI generation command.

### Dashboard

- `apps/dashboard/src/admin/AdminVendorDocuments.tsx` — read-only section and authenticated preview lifecycle.
- `apps/dashboard/src/admin/AdminPortal.tsx` — Vendor-only detail integration.
- `apps/dashboard/src/admin-api.ts` — typed metadata request using existing transport.
- `apps/dashboard/src/admin/admin.css` — shared-theme document cards and mobile stacking.

### Tests/documentation

- `backend/api/src/vendor-documents/admin-documents-ui.test.ts` — four focused non-browser UI/source contracts.
- `backend/api/src/vendor-documents/vendor-documents.integration.test.ts` — Admin security/read/replacement cases alongside existing Vendor regression tests.
- This report.

## Tests and exact results

### Final focused run

Command:

```text
pnpm --filter @workspace/api exec tsx --test src/vendor-documents/vendor-documents.integration.test.ts src/vendor-documents/admin-documents-ui.test.ts
```

**28 passed, 0 failed, 0 skipped.**

Composition:

- **13 Admin integration/security checks**
  - Metadata and private-reference exclusion.
  - Secure current PDF bytes and headers.
  - Anonymous denial on metadata and nested content.
  - Vendor A, Vendor B, Customer and Delivery Partner role denials.
  - Requested-Vendor isolation and wrong-store document rejection.
  - Unknown Vendor, non-Vendor account, malformed ID and store-ID selectors.
  - Mandatory/optional counting, including legacy catalog exemption.
  - Replacement/current-version enforcement and preserved history.
  - Image bytes/MIME through unchanged upload validation.
  - Public-table state unchanged by reads and denials.
- **11 existing Vendor integration regressions**
  - New-only onboarding gate, upload validation, private ownership/RLS denial, replacement/failure behavior, existing catalog flows and protected original stock/history.
- **4 new UI/source contracts**
  - Vendor-only keyed section and informational completion.
  - Existing JSON transport and same-origin authenticated bytes.
  - Safe ephemeral preview, cleanup and stale-version refresh.
  - Responsive/accessibility source rules.

Tests use a disposable local PostgreSQL cluster and synthetic accounts/files. HTTP routing, role lookup, store scoping, transactions and database policies are real; external identity-provider responses and object-storage bytes are simulated. No live Vendor documents or managed application records were read or mutated by these tests.

### Other verification

| Check | Result |
| --- | --- |
| OpenAPI codegen and shared-library TypeScript build | **PASS** |
| API TypeScript check | **PASS** on final code |
| Dashboard Vite production build | **PASS**, 112 modules; existing >500KB JS chunk advisory remains |
| Dashboard TypeScript check | **97 existing diagnostics**, only in `src/admin.test.tsx`, `src/delivery-partner.test.tsx`, `src/vendor-orders.test.tsx` and `vite.config.ts`; none in changed implementation files |
| Initial broader `test:vendor-onboarding` run | **32 passed, 1 failed**: an existing source-string assertion expects the old `setCurrentTab(...)` navigation expression; the current responsive Vendor UI uses `navigateVendor(...)`. This pre-existing assertion was left unchanged. All runtime integration cases and new Admin checks passed. |
| Running API anonymous Admin metadata request | **401**, confirming authentication enforcement |
| API and Dashboard workflows | Restarted once after the coherent changes; both running with clean startup |
| Static Dashboard capture at 320px | Sign-in page rendered normally; does not verify authenticated Vendor Details. Browser emitted development messages and one non-specific resource 404. |

No automated browser journey or deployed-app test was run. Source checks are not a substitute for authenticated interactive acceptance.

## Data preservation confirmation

- No managed application data was modified: Vendor, Product, Master Catalog, stock, cart, order, Customer and Delivery records were not written.
- No database migration, seed, remote SQL mutation, live document upload/replacement, status change or approval was performed.
- No document storage policy or existing object was changed.
- Tests uploaded/replaced only synthetic files in isolated fixtures backed by the simulated storage adapter.
- The read-only invariant test fingerprints every existing public table before and after Admin reads/denials and verifies identical data.
- Existing Vendor upload/replacement code remains unchanged; only current-byte reading was shared.

## Manual acceptance checklist

**Pending authenticated/manual acceptance.** Use authorized test accounts and synthetic, non-sensitive test documents.

### Step 1 — Vendor uploads

- [ ] Sign in as the test Vendor and open Documents.
- [ ] Upload valid test FSSAI, Aadhaar, PAN and Photo files.
- [ ] Verify normal upload, View and completion behavior remains available.

### Step 2 — Admin selects the same Vendor

- [ ] Sign in as Admin.
- [ ] Open Admin → Vendors → select that same Vendor → Vendor Details.
- [ ] Confirm Vendor Documents appears.
- [ ] Confirm Mandatory Documents displays **4/4 Complete**.
- [ ] Confirm optional documents have their own statuses/count and are not part of mandatory completion.
- [ ] Check filename, dates and version metadata; no storage path or unnecessary ID is displayed.
- [ ] Confirm there is no approval/rejection action and Vendor/store status did not change.

### Step 3 — Secure View

- [ ] Click View on FSSAI; verify the PDF opens in the browser.
- [ ] View Photo; verify the image preview fits.
- [ ] If a pop-up is blocked, verify the error instructs how to allow it.
- [ ] Confirm viewing does not navigate to a permanent public storage URL.

### Step 4 — Vendor replacement

- [ ] Replace the FSSAI file through the unchanged Vendor Documents page.
- [ ] Return to/reopen Admin Vendor Details or use Refresh.
- [ ] Confirm the new filename/version/current bytes appear.
- [ ] If using an old selection, confirm View reports a stale version and refreshes rather than displaying the obsolete file.

### Step 5 — Another Vendor and permissions

- [ ] Select a different Vendor; verify only that Vendor's metadata/files are shown.
- [ ] Verify incomplete mandatory uploads display the correct count, even for a grandfathered Vendor with catalog access.
- [ ] Verify Customer, Delivery Partner and non-owning Vendor accounts cannot use Admin document routes or read another Vendor's file.

### Step 6 — Mobile and desktop

- [ ] At **320, 360, 375, 390 and 414px**, verify cards/actions stack without horizontal page scrolling.
- [ ] Test long filenames, loading/error/retry and incomplete/empty states.
- [ ] Confirm View, Refresh and detail-close controls remain reachable.
- [ ] Confirm desktop/tablet details and document viewing remain usable.

## Known limitations / stop condition

- Authenticated UI interactions, browser-specific PDF handling, pop-up permissions and physical-device layout remain manual checks.
- Existing Vendor upload rules do not accept WebP; this task intentionally does not change them.
- The pre-existing navigation source assertion and 97 unrelated Dashboard TypeScript diagnostics remain untouched.
- No optional directory redesign, document approval workflow, publication or unrelated feature work was performed.
