# Phase 8 — Customer Home & Marketplace UX Refinement

## Status

Implemented in the existing Customer application. Automated non-browser checks
passed. Manual browser acceptance is **pending with the user**.

No automated browser journeys were run. A static, signed-out preview snapshot
confirmed that the exported app renders its sign-in screen; this does **not**
verify or accept authenticated shopping flows or responsive layouts.

No Phase 9 work, deployment, database migration or production change.

## 1. Files changed

Customer implementation:

- `apps/customer/App.tsx`
- `apps/customer/src/MarketplaceScreen.tsx`
- `apps/customer/src/HomeHistory.tsx` — new
- `apps/customer/src/CartScreen.tsx`
- `apps/customer/src/OrdersScreen.tsx`
- `apps/customer/src/components/ShoppingProductCard.tsx`
- `apps/customer/src/lib/home-history.ts` — new presentation helpers

Focused tests:

- `apps/customer/src/home-marketplace.test.ts` — new
- `apps/customer/src/lib/home-history.test.ts` — new

Documentation/scope notes:

- `docs/PHASE8_CUSTOMER_UX_REPORT.md` — this report
- `.agents/memory/customer-shopping-boundaries.md` — accepted-phase scope and
  Home versus Continue Shopping navigation constraints

The supplied Phase 8 brief is an input, not an implementation change.
Backend, dashboard, shared API contracts, migrations and database schema were
not changed.

## 2. UX changes

- Real recent-shopping information now appears on Home.
- Current store, location, basket store and basket quantity remain identifiable.
- Failed cart loads no longer claim that the basket is empty.
- Unavailable product-card actions are disabled.
- Existing shopping, variant selection, checkout and delivery workflows remain
  in place; this is not a customer-application or visual-system rewrite.

## 3. Home changes

Home retains product search, optional category discovery, location information
and the eligible supermarket directory. It adds Recent Store, Recently Ordered
and a compact current-order section when an active order exists.

The current-order section displays a short customer-facing order reference,
the existing status, store and View Order action. It opens the existing Orders
screen rather than implementing another tracking system.

Recent-shopping loading, retry, no-history and unavailable states are explicit.
Customers with only cancelled/rejected orders see "No recent shopping to repeat,"
not the inaccurate "No orders yet." Recent Store and current-order panels are
omitted when there is no relevant history/order.

Refresh reloads recent shopping and the order-status summary on demand.
No new polling or notification infrastructure was introduced.

## 4. Search changes

Approved category-optional global search is preserved: typing "rice" does not
require choosing a category or selecting a taxonomy path.

Search continues through the existing pincode-eligible API and keeps separate
store-specific offers. Existing debounce, loading, no-results, friendly error,
retry, clear-search and optional category controls remain.

Product Details → Back retains the current search query/category/page where
applicable. Opening a global offer does not clear the search context.
An explicit Home-tab tap deliberately returns to Home.

## 5. Store discovery changes

The existing pincode/store eligibility endpoint remains authoritative.
Directory state is cleared while a changed location loads, and Recent Store
actions wait for a directory associated with the current pincode.

Saved-address selection is retained on return when it remains valid. An explicit
default-address change, removal or changed address location is respected.
Existing no-store, retry and change-address/location paths remain available.
No vendor-private store fields or new eligibility calculations were added.

## 6. Recently Ordered changes

- Uses the customer's authenticated order summaries.
- Selects the latest two non-cancelled/non-rejected orders within the existing
  order-list response.
- Calls only their existing repeat-preview endpoints and displays up to four
  actual historical lines.
- Shows recorded product/variant labels, store, historical purchase quantity,
  current availability and valid current unit price.
- Does not display historical snapshot price as the current price.
- Does not invent another product, pack size or replacement.
- Missing/invalid current prices and unavailable stores/items disable Buy Again.
- Requests abort on cleanup; activity/address/pincode scoping prevents actions
  from an old Home scope remaining usable.

Buy Again passes the original order ID and order-item ID to the already-approved
repeat dialog. Home seeds that dialog with the currently selected owned address;
the customer may still choose another owned address. The existing dialog/backend
revalidate availability, price, stock and one-store conflict before adding.

## 7. Recent Store changes

Recent Store comes from the latest relevant real order, intersected with the
currently eligible store directory.

An eligible store is opened only on an explicit tap. If that latest store is no
longer eligible for the location, Home explains its unavailability and does not
provide a shopping action for it or silently label an older store as the latest.
No previous qualifying order means no fabricated Recent Store.

## 8. Cart/navigation changes

- Primary navigation remains **Home / Orders / Account**, without permanent Cart.
- Contextual basket access shows the basket's store and quantity.
- A failed basket-summary read provides a visible retry state.
- Ordinary Add to Cart keeps the customer shopping.
- The existing cross-store confirmation/replacement flow is retained.
- Browsing another supermarket does not clear or merge baskets.
- Cart → Continue Shopping carries the actual cart-store intent.
- Returning to the same eligible store preserves the existing detail/search
  context instead of resetting discovery.
- A different eligible cart store is selected explicitly through that return
  action. An ineligible intent shows a notice and does not alter the basket.
- An explicit Home tab tap resets discovery to the actual Home sections.
- Product Details Back continues to use the existing shopping return path.

Checkout, cart quantity serialization, repeat idempotency and mutation rules
were not rewritten.

## 9. Responsive layout changes

Product names/prices use bounded text and shrink-safe regions. Price and the
Add/Choose action remain in separate vertical regions; unavailable actions are
disabled rather than presented as purchasable.

New history rows constrain their text region, keep Buy Again reachable and
provide a 44-pixel minimum button height. Loading text can wrap instead of
overflowing its row. Basket store labels are constrained within the contextual
bar, while existing scroll views and bottom content padding are retained.

The existing mobile-first visual system was preserved. Source/layout-contract
checks passed, but desktop, tablet and mobile pixel layout and scrolling are
reserved for the user's manual acceptance below, not claimed as browser-tested.

## 10. API changes

**None.** Existing customer order-list, repeat-preview, store/category/product,
cart and profile endpoints are reused. No endpoint, response contract, pricing
authority or authorization rule was changed.

No exact-stock, private vendor data, raw identifiers or internal timestamp
presentation was added to Home. Routing/reorder identifiers remain internal
wiring; the current-order panel uses the established short display reference.

## 11. Database migrations and safety

**None.** No new or altered migration, production change, existing-data rewrite,
historical-order modification or legacy delivery-order repair.

Existing stock deduction/restoration, order creation/transitions, historical
snapshots, catalog identities and customer/vendor/partner isolation remain
unchanged. Authentication regression checks used development test identities;
they do not represent production or manual browser acceptance.

## 12. Automated tests

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Customer focused Home/history/navigation + existing shopping/reorder | 43 | 0 | 0 |
| Full API regressions | 194 | 0 | 2 |
| Explicit development Supabase Auth/HTTP checks | 13 | 0 | 0 |
| Relevant dashboard tests | 20 | 0 | 0 |

The two skipped API cases are opt-in cases in the default full-suite invocation.
The explicit authentication checks were also run separately and passed.

New coverage includes real/bounded history selection, no-history versus
cancelled-history states, current store eligibility, exact source-order/item
identity, recorded variant/quantity preservation, current-price validation,
unavailable Buy Again, existing lifecycle statuses, contextual cart versus Home
navigation, eligible-directory wiring, shrink-safe card layout contracts,
customer privacy and explicit refresh without new polling.

These are unit/data/source-contract tests, **not automated browser tests**.
Visual overlap, clipping and actual scrolling still require manual checks.

## 13. Typecheck/build results

| Check | Result |
| --- | --- |
| Full workspace typecheck, including Customer/API/dashboard/artifact packages | Passed |
| Dashboard production build | Passed; existing non-blocking bundle-size warning |
| Customer Expo web export | Passed |
| Customer managed preview workflow | Restarted once; running with new export |
| API standalone build | Not rerun: API code/config unchanged; API typecheck and full regressions passed |
| Deployment | Not performed |

Customer export completed with 343 modules and the preview server started
successfully. No new application exception was visible in the signed-out
snapshot. Its console included a non-blocking resource 404 and the existing
password-field/form advisory; the sign-in UI itself rendered.

## 14. Regression results

Existing API and dashboard suites cover approved authentication/roles, Master
Catalog/vendor products, variants, search, cart/checkout, reorder, inventory,
vendor orders, delivery authorization/lifecycle and historical snapshots.
All enabled checks passed.

Existing customer shopping/reorder tests also passed with the Home additions.
Protected backend, dashboard and shared-contract source changes were absent.
This is automated regression evidence, not a claim that the user has manually
accepted Phase 8.

## 15. Known limitations

- Manual signed-in browser acceptance is pending.
- Responsive layout and scrolling were reviewed in source/contracts, not
  accepted through automated desktop/tablet/mobile browser journeys.
- Home is intentionally a bounded recent-shopping summary, not full order history.
  The existing Orders screen remains the history/detail destination.
- Home's current-order/availability summary refreshes on relevant Home scope
  entry or explicit Refresh, not through new polling. Orders detail retains its
  approved existing refresh behavior.
- Cancelled/rejected orders are excluded from Home's repeat summary, not removed
  from Orders or rewritten.
- Existing non-blocking dashboard bundle-size and signed-out console advisories
  are not expanded into unrelated work.

## 16. Manual browser acceptance checklist

All items below are **pending**. Use the existing development test accounts/data.
Do not treat test/build success as completion of these checks.

1. **Customer login:** sign in and confirm only the Customer portal is shown.
2. **Home loads correctly:** search, location, categories and shopping sections
   are usable; loading/error states do not leave a blank page.
3. **Available supermarkets:** only currently eligible stores appear. Also check
   a location with no stores and retry/change-location behavior.
4. **Recent Store after an order:** return via Home; the latest relevant store is
   shown, taps explicitly open it, and an ineligible historical store has no
   shopping action.
5. **Recently Ordered after an order:** actual products/variant/store/quantity
   appear with current availability/current prices, not old prices.
6. **Search "rice" without a category:** enter the term directly on Home.
7. **Correct search results:** verify eligible store-specific offers, optional
   category filtering, loading, no results, clear and retry.
8. **Multiple variants:** choose the intended pack explicitly; unavailable
   options cannot be selected for purchase or silently substituted.
9. **One variant:** a genuinely single-option product uses the accepted automatic
   selection without another unnecessary selection step.
10. **Out-of-stock product:** availability is clear; Add/Choose is disabled and
    exact stock is not disclosed.
11. **Add to Cart:** selected variant/quantity is added at current server price
    without immediately forcing ordinary shopping into Cart.
12. **Contextual Go to Cart bar:** appears for a nonempty basket, identifies its
    store/count, opens Cart and does not introduce a permanent Cart tab.
13. **Continue Shopping:** adding groceries leaves the current shopping page
    usable; product/category/store context remains understandable.
14. **One-store conflict:** with Store A's basket, add from Store B. Declining
    preserves the original basket; only confirmed replacement changes it.
15. **Product Details → Back:** returns to the expected store/product-list context.
16. **Search → Product → Back:** preserves the search query/category/results
    context, including after opening a different store's offer.
17. **Cart → Continue Shopping:** returns to the actual basket's eligible store;
    same-store detail/search context is retained. Repeat after Buy Again from
    another store; test an ineligible location without changing the basket.
18. **Home scrolling:** bottom stores/history remain reachable; the basket bar
    does not cover actionable content.
19. **Product-list scrolling:** search/catalog bottom rows and pagination remain
    reachable; also scroll long Details and Cart content.
20. **Card price/Add layout:** check long names, brands and whole/decimal prices;
    Add/Choose stays inside the card without price overlap.
21. **Desktop layout:** check a wide browser, then a tablet-sized width; no
    clipping, unnecessary horizontal overflow or hidden actions.
22. **Mobile-sized layout:** check narrow widths and long text; search, variants,
    Buy Again, Add, basket access and bottom content stay reachable.
23. **No exact stock:** inspect Home, search, cards, Details, Cart and Buy Again;
    no private vendor fields/raw IDs appear in visible labels.
24. **Active order:** Home shows the real store/status/short reference; Refresh
    and View Order work. Inspect READY and its approved order history.
25. **OUT_FOR_DELIVERY:** the assigned delivery workflow remains correct and the
    customer sees the approved status/details without partner internal IDs.
26. **DELIVERED:** completion is visible in Orders; delivered historical snapshots
    remain unchanged and delivered orders are not shown as active after refresh.
27. **Buy Again:** Home and Orders use exact historical identity with fresh
    prices/availability; unavailable lines and cross-store confirmation are clear.
28. **Customer logout/login:** no previous customer's history/cart leaks; Home and
    contextual cart reload for the signed-in customer.
29. **Vendor portal:** authentication, catalog/variants/stock and order management
    continue to work without Customer UX affecting vendor permissions.
30. **Delivery Partner workflow:** authentication, own assigned orders, duty,
    delivery completion and authorization remain as accepted in Phase 7.

**Stopped after this report. Phase 9 has not started. Nothing was published.**