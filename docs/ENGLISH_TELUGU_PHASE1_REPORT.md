# English/Telugu localization — Phase 1 report

## Delivered scope

Shared localization foundation only. The language selector and its captions,
help and preference-error feedback translate immediately. Most existing screen
text intentionally remains English until later approved phases. This is not a
claim that all four portals are already bilingual.

No API contracts, backend behavior, database data/schema, authentication or
authorization handlers, cart/stock/pricing/orders/scheduling rules or navigation
destinations were changed. Nothing was published. No automated browser tests
were run.

## Exact files changed or added

### Shared package: `packages/localization/`

- `package.json`, `tsconfig.json`
- `src/dictionaries.ts`: central `en`/`te` dictionaries with common, auth,
  customer, vendor, delivery and admin namespaces.
- `src/translation.ts`: typed keys, language options, interpolation and English
  fallback for missing/blank Telugu values.
- `src/preference.ts`: persistence contract, account-scoped state and
  read/write concurrency protection.
- `src/provider.tsx`: shared stable React provider, scope hook and translation hook.
- `src/index.ts`: package exports.
- `test/preference.test.ts`, `test/provider.test.tsx`,
  `test/integration.test.ts`, `test/fonts.test.ts`.
- `assets/NotoSansTelugu-Regular.ttf`, `assets/NotoSansTelugu-Medium.ttf`,
  `assets/NotoSansTelugu-SemiBold.ttf`, `assets/NotoSansTelugu-Bold.ttf`.
- `assets/OFL.txt`, `assets/README.md`: font license and provenance.

### Customer: `apps/customer/`

- `package.json`: shared localization workspace dependency.
- `index.ts`: stable language provider around the existing App.
- `App.tsx`: scope follows the existing session ID; authentication selector.
- `src/lib/language-storage.ts`: dedicated AsyncStorage adapter.
- `src/components/LanguageSelector.tsx`: reusable accessible selector.
- `src/components/CustomerTypography.tsx`: existing expo-font loading extended
  with static Telugu weights; script-aware Text/TextInput font selection.
- `src/components/AuthControls.tsx`: password-reset selector.
- `src/CustomerSettingsScreen.tsx`: language preference controls, also available
  while account details are loading.

### Dashboard: `apps/dashboard/`

- `package.json`: shared localization dependency and explicit Node development
  typings to avoid conflicting transitive declarations during typecheck.
- `src/main.tsx`: stable language provider around the existing App.
- `src/App.tsx`: existing session-based scope and shared authentication-frame selector.
- `src/language-storage.ts`: dedicated browser localStorage adapter.
- `src/LanguageSelector.tsx`: reusable accessible selector.
- `src/DeliveryPartnerLogin.tsx`: signed-out partner selector.
- `src/VendorStorePanel.tsx`, `src/DeliveryPartnerPortal.tsx`,
  `src/admin/AdminPortal.tsx`: authenticated shell selectors.
- `src/index.css`: self-hosted static font faces and selector styles.
- `src/partner.css`, `src/admin/admin.css`: small responsive shell adjustments
  to accommodate selectors without clipping.

### Workspace and documentation

- Root `tsconfig.json`: shared library project reference.
- `pnpm-lock.yaml`: workspace linkage and development/test dependencies.
- This report.
- Project memory records the approved localization boundaries and type-resolution
  lesson; no user credentials or account identifiers were recorded.

No third-party localization library was added. `react-test-renderer` and its
typings are development-only test tools for checking live React updates without
browser automation.

## Selector locations

- Customer login/registration screen; its inline recovery flow retains the
  surrounding selector.
- Customer reset-password screen.
- Customer Settings.
- Dashboard Vendor/Admin authentication and password recovery/reset frames.
- Delivery Partner login.
- Authenticated Vendor, Delivery Partner and Admin shells.

English and తెలుగు are always available, including before sign-in. Web controls
are non-submit buttons with pressed state and language attributes. Native
controls expose radio/checked state and language hints. Targets are at least
44px high. Selectors preserve current application colors.

## Persistence behavior

- Default: English.
- Customer prefix: `local-basket:customer:language:v1`.
- Dashboard prefix: `local-basket:dashboard:language:v1`.
- Each prefix has an independent signed-out key and account-specific keys.
- A newly encountered account with no saved preference starts in English; it
  does not silently inherit another account's or the signed-out preference.
- Valid preferences reload after reopening on the same app/device.
- Invalid stored values safely fall back to English.
- A failed read uses English and exposes a warning.
- A failed save keeps the current live choice and exposes a warning that it
  may not be remembered on reopening.
- Read revisions prevent delayed hydration from overwriting a choice or another
  account's state.
- Per-key ordered writes and intent tracking prevent slow/stale saves from
  replacing newer selections or surfacing obsolete errors.
- The provider is not keyed by language or account. Language changes rerender
  subscribers without remounting the application or resetting local form state.

Authentication storage is never read, written or cleared by the preference
adapter. Preferences are local; no cross-device or cross-application
synchronization is claimed.

## Fonts and verification

Four static Noto Sans Telugu weights (400/500/600/700), approximately 179KB each,
are bundled with their SIL Open Font License. Source/provenance is documented
beside the files. Static weights avoid depending on native variable-font weight
selection.

Customer loads them through existing expo-font support. Telugu Text and
TextInput content selects the appropriate loaded weight, including mixed
Telugu/English content; English retains Inter. Dashboard serves the same assets
through Vite `@font-face` with an Inter-first Telugu fallback stack.

Verification was not based only on font names:
- Font tests inspect actual TTF tables, confirm static weights and nonzero glyphs
  for Telugu selector text, English letters, digits and ₹.
- An older script-only Noto candidate failed the Latin test and was replaced
  before delivery.
- Customer export and Dashboard build both include all four font assets.
- Static signed-out captures at Customer 320px and Dashboard 390px show Telugu
  selector glyphs alongside English, with usable buttons and no visible clipping.

Physical Android/iOS rendering, full Telugu help-text layouts and authenticated
portal-shell acceptance still require manual preview/device review. These are
not represented as completed device tests.

## Test/build results

- **20/20 new foundation tests passed.**
  - Defaults, fallback, Telugu lookup and literal interpolation.
  - Save/load/reopen, invalid values and storage failures.
  - Account/signed-out isolation and separate application keys.
  - Delayed hydration, account switching and ordered saves.
  - Late errors after leaving/returning and stale identical-save errors.
  - Live React updates preserving mounted form, representative cart-count and
    navigation state.
  - The actual Dashboard selector changes captions and selected state without
    submitting its parent form.
  - Integration locations, accessibility and font contents.
- Existing Customer/Dashboard test run: **106 passed, 1 failed** out of 107.
  - The single failure is the previously identified Customer authentication
    source assertion expecting CustomerApp directly rather than its existing
    SavedItemsProvider wrapper. Authentication code was not changed to satisfy
    an outdated assertion.
  - TSX tests run with the Dashboard's JSX configuration; otherwise older
    receipt/form tests encounter a classic-JSX `React is not defined` harness
    error unrelated to application builds.
- Shared-library typecheck/build: passed.
- Customer typecheck: passed.
- Dashboard typecheck: passed.
- Dashboard Vite production build: passed.
- Customer Expo web export: passed.
- Both preview workflows are running.

Commands:

```sh
pnpm --filter @workspace/localization test
pnpm run typecheck:libs
pnpm --filter @workspace/customer run typecheck
pnpm --filter @workspace/dashboard run typecheck
pnpm --filter @workspace/dashboard run build

pnpm --filter @workspace/api exec tsx \
  --tsconfig ../../apps/dashboard/tsconfig.json --test \
  ../../apps/customer/src/lib/*.test.ts \
  ../../apps/customer/src/home-marketplace.test.ts \
  ../../apps/customer/src/marketplace-scrolling.test.ts \
  ../../apps/dashboard/src/*.test.ts \
  ../../apps/dashboard/src/*.test.tsx
```

Customer export was performed through the existing managed workflow, which
supplies its existing public Supabase environment and preview base path.

The test renderer emits its upstream deprecation warning; it is test-only, not
part of the production application. Signed-out Customer static capture retains
the previously seen resource-404/password-form warnings, outside this scope.

## Manual review checklist

1. Toggle English/తెలుగు before sign-in. Confirm selector caption/help changes
   immediately and typed form values remain unchanged.
2. Refresh/reopen and confirm the same signed-out preference returns.
3. Sign in as two different accounts and verify their preferences remain
   independent; check the no-preference English default.
4. In Customer Settings, change language while editing unsaved profile text.
   Navigate away/return; confirm no cart or navigation state is reset.
5. Inspect Vendor, Delivery Partner and Admin shell selectors at mobile and
   desktop widths; no role or route changes should result.
6. Check Telugu captions and mixed-script entered text on Android/iOS, including
   font weight, clipping, line height and accessibility announcements.
7. Remember that most screen text remains English by design in Phase 1.

Phase 2 has not started and must await review.
