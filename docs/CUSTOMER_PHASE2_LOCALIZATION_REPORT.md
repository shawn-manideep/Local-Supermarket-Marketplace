# Customer English/Telugu — Phase 2 report

## Result and scope

The existing Customer provider, typed dictionary lookup, language selectors,
account-scoped AsyncStorage preferences and bundled fonts are reused.
English remains the default and fallback. No second translator, remote
translation service or locale-dependent screen key was introduced.

There are 520 English keys and 519 Telugu entries. The sole intentionally
missing Telugu entry is `common.englishFallback`, an existing non-UI test
fixture that verifies English fallback without exposing a namespaced key.
Known messages use exact mappings; the only dynamic mappings are fixed stock
message templates, formatted rupee-price prefixes and schema string-length
bounds. Product/variant names within those templates remain verbatim.

No Vendor, Delivery Partner, Admin, dashboard, backend, database schema,
validation-schema, API, dependency or workflow configuration files changed.
The existing Customer preview workflow was restarted once to export and serve
the completed web app. Nothing was published.

## Screen-by-screen coverage

| Area | Translated presentation |
|---|---|
| Authentication | Sign-in/signup headings, username/password/recovery fields, placeholders, validation, visibility controls, recovery/reset screens, notices, loading and access-denied states |
| Home | Greeting, location/search controls, section headings, recent shopping, active order status, empty/error/loading states and navigation labels |
| Stores and browsing | Store availability/closure/opening notices, search/filter controls, category UI labels, listing availability, price prefixes, basket confirmations and accessibility labels |
| Product details | Option selection, stock/availability, selected-option summary, quantity actions, cart actions and accessibility descriptions |
| Favorites/Saved Items | Save/remove controls, availability reasons, loading, errors and empty states |
| Cart | Item/quantity controls, unavailable-item notices, clear/remove confirmations, totals, delivery fee and empty/error/loading feedback |
| Checkout and addresses | Address form labels/placeholders/validation, selection controls, instant/scheduled modes, displayed dates/slots, confirmation, placing-order states and relevant errors |
| Orders and Reorder | Order history/detail headings, status/delivery labels, scheduled delivery display, cancel/reorder dialogs, availability checks and partial/unavailable feedback |
| Account/settings | Profile/password forms, field labels, validation, current-password/re-authentication feedback, save/no-change/success/error messages |
| Shared controls | Buttons, confirmations, retry/loading messages, language controls and user-facing accessibility labels |

Interface dates use en-IN/te-IN for display. India day keys remain en-CA, and
the original scheduling calculations, ISO timestamps and accepted windows
are unchanged. Generic order timestamp formatting retains its original
device-timezone behavior; scheduled delivery displays retain India time.
Feedback is kept canonical in state and localized when rendered, so a
language change also updates an already-visible validation or success message.

## Intentional English/data exceptions and audit

The AST audit found no remaining literal English JSX text or user-facing
literal attributes outside allowed Local Basket branding and numeric or
symbol-only values. Another audit checks canonical frontend feedback against
the dictionaries and rejects inline Telugu outside the shared catalog.

The following are intentionally not translated:

- Local Basket brand identity; language autonyms English and తెలుగు.
- Actual store/product/category/variant names, descriptions, customer names,
  addresses, historical snapshots and arbitrary notes or unknown service text.
- IDs, PIN codes, phone/email/username values, rupee symbols/amounts, numeric
  quantities, standard measurement identifiers and IST.
- Enum values, routes, query keys, request bodies, business-date keys,
  non-user-facing code/logs and canonical English feedback stored in state.

The original shared House/Flat address field and existing delivery-location
formatter remain unchanged; language switching does not infer or rewrite
address content. Existing Customer regression assertions were updated only
where translated label syntax changed.

## Verification

| Check | Result |
|---|---|
| Existing Customer regression suite | **68/68 passed** |
| Localization suite | **25/25 passed** |
| Workspace library typecheck | Passed |
| Customer typecheck | Passed |
| Localization typecheck | Passed |
| `git diff --check` | Passed |
| Customer Expo web export | Passed: 475 modules, 22 assets, 1.42 MB web bundle |
| Preview workflow | Running at the existing Customer preview path |
| Static signed-out 320×900 capture | Readable, no horizontal clipping |
| Automated browser tests | Not run, as requested |
| Deployment/publishing | Not performed |

Commands:

```sh
pnpm --filter @workspace/localization test
pnpm --filter @workspace/api exec tsx --tsconfig ../../apps/customer/tsconfig.json --test \
  ../../apps/customer/src/lib/*.test.ts \
  ../../apps/customer/src/home-marketplace.test.ts \
  ../../apps/customer/src/marketplace-scrolling.test.ts
pnpm run typecheck:libs
pnpm --filter @workspace/customer typecheck
pnpm --filter @workspace/localization typecheck
git diff --check
```

The API package supplies only the installed test CLI for Customer unit tests;
no API code or operational behavior was changed. The existing preview
workflow runs the Customer `expo export --platform web --max-workers 2`
command and serves that output. A typecheck attempt run alongside the export
timed out; the subsequent Customer and localization checks both passed.

## Font/layout limitations

The existing bundled Noto Sans Telugu regular/medium/semibold/bold fonts are
included in the export; the glyph/weight regression test passes. English uses
the existing Inter setup. No fonts or cross-portal CSS were changed.

Long-text wrapping and existing flexible card/control layouts are retained.
The static capture verifies signed-out English layout and Telugu language
autonym only; it does not constitute authenticated Telugu acceptance.
Physical Android/iOS glyph shaping, device Intl support, long Telugu product
cards/dialogs and all authenticated layouts still require manual review.
The capture reported a nonfatal resource 404 and the existing password-field
outside-form browser advisory; it showed no app render failure. The missing
resource was not identified by the capture.

## Manual acceptance checklist

1. Switch English ↔ తెలుగు while entering login, signup or recovery details;
   verify inputs and navigation remain in place and all labels/errors update.
2. Sign in, switch language in settings and reopen the app. Verify the same
   account remembers its preference; another account and signed-out scope
   retain their own preferences.
3. Browse Home, store/category search, product cards/details and Saved Items.
   Check Telugu headings/statuses; verify real names, prices and addresses
   have not changed.
4. Keep a populated cart and unsaved address/settings form active while
   switching languages. Verify quantities, chosen variants, selected address,
   draft values and checkout state remain unchanged.
5. Review instant/scheduled delivery, today/tomorrow/date/slot displays and
   closed-store notices. Verify the same selectable windows and totals.
6. Review orders, delivery status, cancel/reorder confirmations and partial
   availability feedback; verify IDs and historical content are unchanged.
7. At 320, 360, 390 and 414 px and on Android/iOS, check long Telugu text,
   product cards, bottom navigation, dialogs, validation and screen-reader
   labels for clipping/overlap. Repeat in English.

## Exact changed files

### Customer runtime
- `apps/customer/App.tsx`
- `apps/customer/src/CartScreen.tsx`
- `apps/customer/src/CustomerSettingsScreen.tsx`
- `apps/customer/src/HomeHistory.tsx`
- `apps/customer/src/MarketplaceScreen.tsx`
- `apps/customer/src/OrdersScreen.tsx`
- `apps/customer/src/SavedItemsScreen.tsx`
- `apps/customer/src/components/AuthControls.tsx`
- `apps/customer/src/components/ConfirmationDialog.tsx`
- `apps/customer/src/components/FavoriteControl.tsx`
- `apps/customer/src/components/PhoneInput.tsx`
- `apps/customer/src/components/QuantitySelector.tsx`
- `apps/customer/src/components/ShoppingProductCard.tsx`
- `apps/customer/src/components/ShoppingProductDetails.tsx`

### Customer-only shared localization
- `packages/localization/src/dictionaries.ts`
- `packages/localization/src/index.ts`
- `packages/localization/src/customer-message.ts` (new)
- `packages/localization/src/service-messages.ts` (new)

### Tests
- `apps/customer/src/home-marketplace.test.ts`
- `apps/customer/src/lib/address-format.test.ts`
- `apps/customer/src/lib/auth-search.test.ts`
- `apps/customer/src/lib/cart-quantity.test.ts`
- `apps/customer/src/lib/reorder.test.ts`
- `apps/customer/src/lib/shopping.test.ts`
- `packages/localization/test/provider.test.tsx`
- `packages/localization/test/customer-coverage.test.ts` (new)

### Documentation
- `docs/CUSTOMER_PHASE2_LOCALIZATION_REPORT.md` (new)
- `.agents/memory/localization-boundaries.md` (durable presentation/data boundaries)

The uploaded requirements file is user input, not an implementation change.
Work stops after this Customer-only phase.
