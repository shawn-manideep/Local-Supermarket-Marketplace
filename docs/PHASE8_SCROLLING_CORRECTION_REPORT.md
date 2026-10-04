# Phase 8 correction — Customer Marketplace vertical scrolling

## 1. Root cause

The exported Expo HTML intentionally sets `body { overflow: hidden }` and a
full-height root. Vertical scrolling belongs to React Native Web's existing
`ScrollView`, whose implementation supplies `overflow-y: auto`, not to the body.

The Customer shell, content pane and Marketplace wrappers previously relied on
`flex: 1` without an explicit window-height cap. The list ScrollViews also left
their flex basis to content sizing. That made available-height allocation
implicit through the wrapper chain, with no document-scroll fallback when a
long list exceeded the visible area.

The correction explicitly constrains that existing shell and flex chain.
This diagnosis is based on inspecting the actual source, generated Expo HTML
and installed React Native Web scroll implementation. Signed-in DOM geometry
and interaction acceptance were not measured through browser automation.

## 2. Files changed

Runtime layout only:

- `apps/customer/App.tsx`
- `apps/customer/src/MarketplaceScreen.tsx`
- `apps/customer/src/components/ShoppingProductDetails.tsx`
- `apps/customer/src/theme.ts`
- `apps/customer/src/lib/viewport-layout.ts` — new shared layout constants/helper

Verification/documentation:

- `apps/customer/src/marketplace-scrolling.test.ts` — five focused tests
- `docs/PHASE8_SCROLLING_CORRECTION_REPORT.md` — this report
- `.agents/memory/customer-shopping-boundaries.md` — user scrolling constraints

The application entry is `apps/customer/App.tsx`; no duplicate
`apps/customer/src/App.tsx` was created.

## 3. Exact layout/overflow correction

- Customer web shell uses the initial/current `useWindowDimensions().height`
  as both its height and maximum height. It does not require a resize event
  before getting a height.
- The existing content pane, retained Marketplace wrapper and Marketplace
  root explicitly use `flexGrow: 1`, `flexShrink: 1`, `flexBasis: 0`,
  `minHeight: 0` and `minWidth: 0` on web.
- The existing Home, global-search, store-catalog and Product Details
  ScrollViews use the same bounded flex style. They occupy the remaining
  content height rather than sizing the viewport from their entire content.
- React Native Web continues to provide `overflow-y: auto` and
  `overflow-x: hidden` on those existing vertical ScrollViews.
- There is no new outer ScrollView, body-scroll override, global stylesheet,
  fixed/sticky header change or navigation-stack change.
- Horizontal category strips remain horizontal and unchanged.
- Primary navigation remains outside the scrolling content.
- The contextual cart bar remains in place. Existing 100-pixel page-bottom
  padding is preserved and checked against its 64-pixel minimum height plus
  12-pixel bottom offset. Product Details retains its additional cart clearance.
- All new bounds are web-only. Native styles receive an empty viewport style
  and no forced window height.

## 4. API/database/data changes

**None.** No API, database migration, seed, product, variant, price, stock,
checkout, cart rule, reorder, authentication, delivery or order-lifecycle change.
Vendor and Delivery Partner portal source was not changed.

No fake products were created. No production change or deployment.

## 5. Customer tests

**48 passed, 0 failed, 0 skipped.**

This includes all 43 existing Customer shopping/reorder/Home checks plus five
focused layout checks covering:

- Shell bounds for 1440 × 900, 1024 × 768 and 390 × 844 viewport values.
- Zero-basis, shrinking flex allocation without another overflow owner.
- Bounds through the Customer/Marketplace wrapper chain.
- All existing vertical Marketplace/Details ScrollViews, with no extra wrapper.
- Native-platform isolation, preserved category scrolling and basket clearance.

These are unit/source-contract tests, not browser geometry or wheel/touch tests.
No automated browser testing was performed.

## 6. Typecheck/build

- Customer typecheck: **passed**.
- Full workspace typecheck: **passed**.
- Customer Expo web export: **passed**, 345 modules.
- Customer managed preview: restarted once and **running** with the new export.
- Diff whitespace check: **passed**.

A static signed-out 1440 × 900 snapshot confirmed the exported app starts and
renders sign-in. It does not test authenticated Marketplace scrolling.

## 7. Known limitations / pending acceptance

Actual scrolling with the existing long product list, mouse wheel, trackpad,
scrollbar and touch remains for the user's manual browser verification.
Responsive dimensions were checked as layout inputs, not claimed as completed
browser acceptance.

The existing centered, mobile-first maximum width was intentionally retained;
this correction does not redesign the desktop product grid.

## Required manual checklist

Use existing marketplace data with enough products to exceed the viewport.
All checks below are **pending**:

1. **Normal desktop, approximately 1440 × 900:** scroll from top to bottom without
   minimizing, resizing or changing zoom.
2. **Mouse wheel:** scroll over the product list normally.
3. **Scrollbar/trackpad:** reach both ends of the list.
4. **Tablet, approximately 1024 × 768:** scroll the complete content.
5. **Mobile, approximately 390 × 844:** touch-scroll the complete content.
6. **Final product row:** every final visible product and Add/Choose action is
   reachable, including pagination where present.
7. **Contextual cart bar:** with a nonempty cart, the last row clears the bar and
   its actions remain usable.
8. **Search:** search "rice" without a category and scroll through the results.
9. **Categories:** horizontal category scrolling and selection remain usable.
10. **Product Details:** open a product and scroll long details/variant content.
11. **Back:** Details → Back and Search → Product → Back retain their expected
    context; also verify Cart → Continue Shopping.
12. **No horizontal overflow:** check all three sizes, including long product names.

**Stopped after this correction. No Phase 9 work and no deployment.**