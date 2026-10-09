# Customer Home refinement and cart quantity fix

## Files and components changed

| File | Change |
|---|---|
| `apps/customer/src/MarketplaceScreen.tsx` | Removed Home category tiles and their unused styles; refined header/search spacing; synchronized contextual cart counts with quantity changes and guarded against stale refresh responses. |
| `apps/customer/src/components/ShoppingProductCard.tsx` | Consistent image proportions, readable name/price hierarchy and card spacing using existing tokens. |
| `apps/customer/src/CartScreen.tsx` | Enabled minus at one, immediate quantity/totals updates, serialized persistence, failure reconciliation and existing pending-write checkout guard. |
| `apps/customer/App.tsx` | Passed cart-summary updates through the existing Customer app so Home's contextual bar reflects removals immediately. Existing routes/nav unchanged. |
| `apps/customer/src/lib/cart-quantity.ts` | Focused, testable quantity controller and exact-cent optimistic totals. Pending changes finish across navigation; returning views wait for persistence. |
| `apps/customer/src/lib/cart-quantity.test.ts` | Nine focused quantity, identity, totals, persistence, rapid-tap, failure and Home/navigation regressions. |
| `apps/customer/src/marketplace-scrolling.test.ts` | Updated the scroll-container expectation for the removed Home category section while retaining page and category-control checks. |
| `backend/api/src/vendor-documents/vendor-documents.integration.test.ts` | Added real HTTP/database cart persistence coverage using the existing disposable test database. No backend runtime change. |

## Home changes

The complete **Shop by Category/Categories** Home section, circular tiles, labels and associated spacing were removed. Category data, endpoints, store category filters and browsing remain intact.

The existing blue/navy/light/white palette, logo, branding, Home/Reorder navigation, routes, favorites, store selection and shopping behavior remain unchanged. Header/search spacing and product image/text/price alignment are refined; existing bottom padding remains. This screen does not currently render a promotional banner, so none was invented or added.

## Minus-button cause and fix

1. Cart used `QuantitySelector` with `min={1}`, disabling minus at exactly one before the handler could run.
2. Its queued quantity logic clamped intermediate targets to one and calculated deltas from render-time quantities. Rapid presses could therefore stop at one.
3. Independent per-line writes could return full cart snapshots out of order, making displayed totals stale.

Cart now uses a zero minimum; purchase-option draft quantities retain their existing minimum of one. The existing API `PATCH /api/customer/cart/items/:itemId` receives quantity zero to remove the exact line. It already marks a cart abandoned and returns a null cart when the last item is removed.

The focused controller applies each press to the latest target, never below zero; serializes writes; preserves pending intent over older responses; and cannot resurrect a queued removal. It updates line totals, subtotal, total, count and contextual-bar summary immediately using server-provided prices. Failures reload authoritative data and show an error. Pending changes continue when leaving Cart and are awaited before a returning view reloads.

No database schema, backend stock rules, checkout validation, order placement or inventory behavior was changed. No Vendor, Delivery Partner or Admin functionality was modified.

## Verification

**98 distinct tests passed:**
- 66 focused and existing Customer/cart tests.
- 32 existing API integration tests, including the added persisted-removal test.

Coverage includes:
- Decrement above one and remove at one.
- Last-line removal and null empty-cart state.
- Exact-cent totals and immediate optimistic updates.
- Rapid presses, multiple-line writes and stale-response protection.
- Failed-update reconciliation.
- Persisted reload after navigation.
- Exact product/variant identity and another Customer/store remaining untouched.
- Last-item abandonment and unchanged inventory quantities.
- Category browsing and Home/Reorder navigation retained.

Customer and API typechecks passed. Customer Expo web export succeeded, and the Customer preview workflow is running.

No automated browser tests were run. A static 390px signed-out capture confirmed the app shell renders, not authenticated acceptance of Home/Cart. Its resource-404/password-form warnings remain outside this task's scope.

No live test data was seeded, no schema migration was needed, and nothing was published.

## Remaining manual preview checks

1. At **320px, 390px and desktop**, inspect Home header/search spacing, product names/images/prices/Add alignment, and bottom-navigation clearance.
2. Confirm Home has no category tiles or empty gap. Open a store and verify category filtering, search, favorites and product details still work.
3. In Cart, decrease a line from 3 → 2 → 1 → removed. Check the count, subtotal and total after each press.
4. Add two variants of the same product; remove one and confirm the other remains. Repeat with the last line and confirm the existing empty-cart state.
5. Tap minus repeatedly with a slow network, then navigate Home and return. Verify no negative quantity, duplicated item, reappearing removed item or stale contextual cart bar.
6. Check the original Home/Reorder destinations, closed-store/scheduled-delivery notice and unchanged purchase-option quantity selection.
