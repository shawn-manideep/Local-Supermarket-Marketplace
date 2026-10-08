# Customer Saved Items, Settings and Vendor Product Images

## Scope and status

Implemented the requested functionality in the existing Customer app, Vendor dashboard and API. No deployment or automated browser tests were run.

The implementation keeps cart, checkout, inventory, orders, delivery and Master Catalog business logic unchanged. Existing Supabase authentication and App Storage are reused. Private Vendor Documents storage, policies and management screens were not changed.

Authenticated Customer9/Vendor8 browser acceptance is **pending manual testing**. Non-browser tests and build checks are recorded below; they are not presented as browser acceptance.

## Files changed

### Customer

- `apps/customer/App.tsx`: functional Saved Items/Settings menu entries, authenticated-user-scoped favorites provider, saved-item navigation.
- `apps/customer/src/MarketplaceScreen.tsx`: refresh favorite state for the active address and open an exact saved store/product through the existing shopping flow.
- `apps/customer/src/SavedItemsContext.tsx`: generated saved-item API calls, shared save state, refresh/error handling and stale-response guards.
- `apps/customer/src/SavedItemsScreen.tsx`: saved listings, current prices/units, store, availability, remove/retry and existing shopping navigation.
- `apps/customer/src/CustomerSettingsScreen.tsx`: safe account data, existing profile editing and password change.
- `apps/customer/src/components/FavoriteControl.tsx`: accessible save/unsave control; pressing it does not propagate to the product-card action.
- `apps/customer/src/components/ShoppingProductCard.tsx` and `ShoppingProductDetails.tsx`: favorite controls and uploaded-image rendering.
- `apps/customer/src/lib/api.ts`: existing-origin image resolution and Supabase-session token getter for generated API functions.

### Vendor dashboard

- `apps/dashboard/src/VendorProductImageInput.tsx`: shared source selector, URL validation, upload, preview, replacement and failure handling.
- `apps/dashboard/src/VendorNewProductPanel.tsx`: shared image input for new local products.
- `apps/dashboard/src/CatalogManagementPanel.tsx`: shared image input for existing products.
- `apps/dashboard/src/index.css`: narrowly scoped styles for these controls.

### API, schema and contracts

- `backend/api/src/customer-saved/routes.ts`
- `backend/api/src/customer-settings/routes.ts`
- `backend/api/src/product-images/routes.ts`
- `backend/api/src/product-images/storage.ts`
- `backend/api/src/product-images/validation.ts`
- `backend/api/src/app.ts`: register the new routes.
- `backend/api/src/catalog-management/local-products.ts` and `routes.ts`: enforce store ownership of managed product-image references on create/edit.
- `backend/api/src/customer-marketplace/routes.ts`: export the existing read-only variant projection helper for reuse; existing discovery/cart behavior is unchanged.
- `packages/validation/src/index.ts`: product-image field accepts validated HTTP(S) URLs or managed upload references.
- `lib/db/src/schema/index.ts`: Saved Items table declaration.
- `database/migrations/0020_customer_saved_items.sql`: forward-only Saved Items migration.
- `lib/api-spec/openapi.yaml`: endpoint contracts and image-reference input documentation.
- Regenerated `lib/api-client-react/src/generated/api.ts`, `api.schemas.ts`, `lib/api-zod/src/generated/api.ts`, and the corresponding generated type files/index.
- `lib/api-zod/src/index.ts`: explicitly disambiguate generated request-body validator/type exports.

### Tests and documentation

- `backend/api/src/customer-saved/saved-settings-images.integration.test.ts`
- `backend/api/src/customer-settings/password-provider.test.ts`
- `backend/api/src/customer-saved/ui-contracts.test.ts`
- This implementation report.
- Project memory records the approved favorite, profile/password and product-image ownership boundaries.

## Database changes

Added only `public.customer_saved_items`:

| Column | Purpose |
| --- | --- |
| `customer_id` | Authenticated owner; FK to existing Customer, cascading only on Customer deletion |
| `product_id` | Exact store-specific listing; FK to Product, restricted against hard deletion |
| `created_at` | Saved timestamp |

The composite primary key `(customer_id, product_id)` prevents duplicate favorites. An owner/timestamp index supports listing.

There are no duplicate Product, Master Product, variant, image or cart tables. Product images continue to use the existing `products.image_url` field.

The migration was applied to the existing **development Supabase database** through the established migration mechanism. Approved earlier migrations were not edited. No production migration or deployment was performed.

RLS is enabled. Direct `PUBLIC`, `anon` and `authenticated` table access is revoked; application requests use authenticated API routes and server-derived ownership. The existing service role receives only SELECT/INSERT/DELETE access to this table.

Development read-back confirmed RLS enabled, no anonymous/authenticated direct SELECT grant, and zero live favorites created by verification. Before/after counts remained: Products **45**, variants **93**, Master Products **687**, orders **26**, order items **43**, Vendor Documents **4**. Automated data mutations were confined to disposable test databases; the live storage smoke test used a temporary object and deleted it.

## APIs

| Method / route | Behavior |
| --- | --- |
| `GET /api/customer/saved-items?pincode=...` | Own favorites with current safe Product/active variant data, store and availability. Pincode is optional; without it, favorites remain listed but unavailable until an address is selected. |
| `POST /api/customer/saved-items` | Strict `{productId, pincode}` input; verifies own address and normal listing visibility. First save returns 201; repeat returns 200 without duplication. |
| `DELETE /api/customer/saved-items/:productId` | Deletes only the authenticated Customer's matching favorite; idempotent 204. |
| `GET /api/customer/account-settings` | Returns only username, masked registered/recovery email, existing full name and phone. |
| `POST /api/customer/account-settings/password` | Strict current/new/confirmation inputs; verifies current password with Supabase before updating the same user's password. |
| Existing `PATCH /api/customer/profile` | Reused unchanged for full name/phone editing. |
| `POST /api/vendor/product-images?fileName=...&productId=...` | Raw JPEG/PNG/WebP upload. Optional existing Product ID must belong to the authenticated Vendor's store. Returns a managed image reference. |
| `GET /api/product-images/:storeId/:imageId` | Serves an image referenced by an active published Product in an active store/category; otherwise permits only authenticated owning-Vendor preview. |
| Existing Vendor Product create/PATCH routes | Accept the one selected image source and enforce ownership of managed references. |

Invalid inputs, missing authentication, forbidden roles, unavailable listings, storage failures and password failures return explicit errors. No password/session secrets or storage bucket paths are returned.

## Saved Items behavior

- Menu placeholder replaced by a functional page; cards and details have save/unsave controls.
- Favorites are persistent server records, not temporary local-only state.
- Identity is the listing's Product ID, **not** its name or Master identity. Two stores selling the same Master Product remain two distinct favorites.
- Reads use current authoritative product/brand/image/price/active variant data and existing variant formatting/ordering.
- Address ownership, active product/store/category, store service pincode, current stock-derived purchasability and opening hours determine availability.
- Saving an otherwise visible out-of-stock or closed-store listing is allowed; it is not represented as purchasable.
- Unavailable records remain listed and removable. Images are withheld when the listing is outside normal address/catalog visibility.
- Loading, error/retry and empty states are present. Shared favorite state resets on authenticated-user remount, and stale read results cannot overwrite newer mutations.
- Opening an available item selects its exact store/product in the existing shopping experience. Browsing is disabled while availability refresh is pending or failed.
- No favorite operation reserves stock, changes inventory, inserts cart items or places an order. Existing explicit variant/quantity/cart actions remain required.

## Settings behavior

- Menu placeholder replaced by functional Settings.
- Username is read-only. The registered/recovery email is masked; internal Auth identifiers, JWTs, refresh tokens and password data are not displayed.
- Existing full name and phone fields use the existing validated profile endpoint; no new profile fields or identity-reassignment feature were introduced.
- Password form includes current, new and confirmation fields, reusing existing password controls and the 8–128-character policy.
- Server rejects mismatches and malformed/protected inputs before contacting the password provider.
- Existing Supabase password sign-in verifies the current password in a temporary non-persistent session. Returned user identity must match the authenticated Customer before `updateUser`.
- Only the temporary verification session is explicitly signed out; no global sign-out operation is introduced.
- An additional process-local limit permits up to five password-change attempts per Customer in 15 minutes; successful change clears that counter. Supabase's own protections remain in effect.
- Password drafts are cleared after submission. Provider errors are sanitized; no plaintext passwords are stored in application tables or returned.

## Image URL behavior

- Both new-product and existing-product forms use the same `Image URL` / `Upload Image` selector.
- Only one source is active. Switching source clears the inactive value; saving uses the single existing image field.
- URL input requires an HTTP(S) URL. Invalid text, unsafe schemes and URLs containing embedded credentials are rejected.
- A URL can be previewed and replaced before saving. An uploaded managed reference is also a valid stored image value.
- URL syntax is validated; external image-server reachability is not guaranteed or fetched server-side.

## Image upload behavior

- Allowed extensions/MIME types: JPG/JPEG (`image/jpeg`), PNG (`image/png`), WebP (`image/webp`).
- Maximum **5 MiB**, with empty files, extension/MIME mismatches, unsupported/executable types and invalid signatures rejected.
- Server performs basic content-signature/boundary checks: JPEG start/end, PNG signature/IHDR/IEND and dimensions, WebP RIFF/container/chunk markers. This is not claimed to be a full image decoder or malware scanner.
- Preview, file replacement, upload progress/error feedback and object-URL cleanup are provided.
- Product save is blocked while upload is in progress. Failed replacement upload restores the prior selected image.
- Upload sends the existing bearer identity and preserves same-origin preview cookies; it does not repeat the earlier credentials-omission pattern.
- Existing-product uploads check Product ownership before storing bytes.
- Store ownership is also enforced when saving a managed reference, including absolute URLs whose path points to the managed image route.
- Customer product cards, details and Saved Items resolve managed references through the existing API origin; existing external image URLs remain supported.

## Storage and access rules

Reused the provisioned **Replit App Storage** bucket and its existing credential sidecar. No new bucket or Supabase Storage provider was introduced.

Product bytes use a dedicated `product-images/{storeId}/{imageId}` namespace under the existing public-object search root. The API returns only `/api/product-images/{storeId}/{imageId}`, not bucket names, private paths or provider credentials.

`PRIVATE_OBJECT_DIR`, private Vendor Document paths and document access policies are untouched. The existing new-Vendor catalog-document gate is reused for product-image upload; grandfathered Vendors retain their existing policy.

Published Product images are customer-visible assets, comparable to existing external HTTP(S) product photos; their bytes do not require Customer authentication once linked to a normally published active Product. Inactive, unlinked or retired-store/category images are not served to Customers/anonymous callers. Owning Vendors can preview their staged images with authentication. Responses use `no-store`, `nosniff` and a sandbox content policy.

Canceled forms can leave an unlinked staged image. It remains unavailable to Customers; background retention/cleanup jobs were not added outside the requested scope.

Vendor image changes never write Master Product images or private document metadata.

## Verification

### Focused non-browser automated tests: **19 passed, 0 failed, 0 skipped**

| Test group | Passed | Failed |
| --- | ---: | ---: |
| Disposable PostgreSQL + real Express HTTP/authz integration | 11 | 0 |
| Supabase password-boundary unit tests | 4 | 0 |
| UI source-contract checks (not browser interaction tests) | 4 | 0 |
| **Total** | **19** | **0** |

Command:

```sh
pnpm --filter @workspace/api exec tsx --test \
  src/customer-saved/saved-settings-images.integration.test.ts \
  src/customer-settings/password-provider.test.ts \
  src/customer-saved/ui-contracts.test.ts
```

Integration tests use all migrations in a disposable PostgreSQL cluster. Only external Supabase identity/password-provider calls and object-storage bytes are simulated; API routes, role/ownership guards, input validation, SQL and RLS denials are real.

Coverage includes persistence/read-back, duplicate saves, cross-Customer isolation, direct SQL denial, own-address checks, same-Master/different-store identities, current changed variant price, unavailable removal, profile edits, safe account fields, password validation/current-password failure, allowed/unsafe URLs, format/size/content rejection, cross-Vendor upload/reference/edit denial, staged/public/inactive image access, failed upload preservation, new-product and existing-product image writes, Master-image protection, and unchanged existing variant prices/stock/cart/orders.

Additional checks:

- **1 real App Storage smoke check passed**: temporary PNG put/read, MIME and byte equality, then deletion. No live Product was changed for this check.
- OpenAPI code generation and shared-library TypeScript build: passed.
- API TypeScript check: passed.
- Customer TypeScript check: passed.
- Dashboard production build with the existing Supabase public configuration: passed; existing large-chunk advisory remains.
- Customer Expo Web export: passed.
- API, Dashboard and Customer workflows restarted and are running; logs showed successful startup/export.
- Running API rejected unauthenticated Saved Items and Settings requests with **401**.
- Signed-out Customer preview screenshot rendered the existing login page. Its resource-404 and password-form console notices were not treated as authenticated-feature acceptance or expanded into unrelated fixes.
- Full Dashboard TypeScript check remains blocked by **97 existing diagnostics** confined to `src/admin.test.tsx`, `src/delivery-partner.test.tsx`, `src/vendor-orders.test.tsx`, and `vite.config.ts`. No changed Dashboard implementation file appeared in those diagnostics; unrelated errors were not fixed.

No automated browser journey, production deployment, live account password change or live commerce mutation was performed.

## Manual acceptance checklist — pending

### Customer9: Saved Items

1. Sign in normally and select an existing saved delivery address.
2. Confirm Saved Items and Settings no longer say Coming soon.
3. Save a visible listing from a card; confirm its card/detail state agrees.
4. Open Saved Items and check name, current brand/image, store, current price and variant quantity/unit.
5. Reload/sign out/sign back in; confirm the favorite remains.
6. Save the same Master Product from a different store; confirm separate store-specific entries.
7. Open an available saved listing; confirm its exact store/product opens and no item is automatically added to cart.
8. Verify the normal explicit variant/quantity choice remains required when buying.
9. Remove from details and Saved Items; confirm shared state/read-back.
10. With a controlled listing unavailable, store closed or address unserved, confirm an unavailable state and ability to remove; no stock/cart/order change.
11. Sign in as another existing Customer and confirm Customer9's favorites are not visible or removable.
12. Verify empty, loading, retry/error and no-address states on narrow and desktop layouts.

### Customer9: Settings

1. Verify username and masked registered/recovery contact; no internal UUIDs or session secrets appear.
2. Edit full name/phone, save and reload; check existing Profile reflects the same values.
3. Check malformed phone/profile inputs receive validation feedback.
4. Check mismatched, short and incorrect-current-password submissions fail clearly.
5. Perform an approved manual password change with the correct current password; verify success and cleared fields.
6. Sign out and verify new-password login. Handle any manual restoration through the existing approved process; do not place passwords in this report.

### Vendor8: new-product image

1. Sign in normally and satisfy the existing document gate if this is a newly gated Vendor.
2. Choose Image URL, enter a reachable HTTP(S) photo and verify preview.
3. Replace it, save a unique local product, and check its Customer-facing image.
4. Reject malformed URL text and unsafe schemes.
5. Choose Upload Image; verify the inactive URL is cleared.
6. Upload valid JPEG, PNG and WebP samples; verify preview, replacement, progress and save blocking during upload.
7. Reject empty, executable/unsupported, mismatched and over-5-MiB samples.
8. Save an uploaded photo, reload the listing and verify Customer card/detail/Saved Items display it.

### Vendor8: existing product/security

1. Open an owned existing product; confirm its current external/uploaded image preview.
2. Replace via URL and upload in separate edits; verify only the selected source persists after reload.
3. Simulate upload failure; verify a clear error and preservation of the previous selected image.
4. Confirm other Vendor products/images cannot be edited or attached as owned managed references.
5. Verify unlinked/inactive managed images are unavailable to Customers but authenticated owning-Vendor preview works.
6. Confirm Master Catalog image/name/identity and private Vendor Documents remain unchanged.
7. Verify existing prices, variant ordering, stock, cart, checkout, orders and delivery behavior without adding new business changes.

## Stop condition

Requested implementation and focused non-browser verification are complete. Manual authenticated browser acceptance remains explicitly pending. No deployment, unrelated refactor, automated browser test, or additional feature work was performed.
