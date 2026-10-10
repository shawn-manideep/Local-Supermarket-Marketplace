# Customer-only English/Telugu localization

## Scope

Localization now belongs exclusively to the Customer Portal. The previous
all-portals implementation report is marked historical/superseded.

This phase retains the working Customer foundation and language controls.
Only their captions, help and language-storage feedback translate now; most
Customer screen text intentionally remains English for the next approved phase.
Nothing was deployed or published. No automated browser tests were run.

## Other-portal changes removed

The initial working Git diff was clean because prior localization work was
already checkpointed. The preceding source revision was inspected, and only
identified localization additions were removed through targeted edits.
No broad reset, checkpoint rollback or unrelated source revert was performed.

These nine runtime/style files now match their **pre-localization versions
byte-for-byte**:

- `apps/dashboard/src/App.tsx`: removed scope hook and authentication selector.
- `apps/dashboard/src/main.tsx`: removed language-provider wrapper.
- `apps/dashboard/src/DeliveryPartnerLogin.tsx`: removed selector and its
  layout wrapper.
- `apps/dashboard/src/DeliveryPartnerPortal.tsx`: removed shell selector.
- `apps/dashboard/src/VendorStorePanel.tsx`: removed shell selector.
- `apps/dashboard/src/admin/AdminPortal.tsx`: restored the original top header.
- `apps/dashboard/src/admin/admin.css`: removed selector layout adjustments.
- `apps/dashboard/src/partner.css`: removed selector and login-wrapper rules.
- `apps/dashboard/src/index.css`: removed language-control styles, Telugu
  font faces and font-stack override.

Deleted feature-only files:

- `apps/dashboard/src/LanguageSelector.tsx`
- `apps/dashboard/src/language-storage.ts`

Removed `@workspace/localization` from `apps/dashboard/package.json` and its
lockfile importer. Existing development-only Node typings remain; they are a
typechecking compatibility fix, not a language feature or runtime/UI change.
No pre-existing dashboard authentication, account, navigation, API or operational
handlers were changed. Existing stored browser preferences were not deleted;
the dashboard simply no longer reads or writes language preferences.

Checks confirm that dashboard source has no localization imports/provider,
selector, storage adapter or Telugu font/style references. Its build contains
no Telugu font assets. The signed-out mobile preview shows the restored
authentication layout without language controls.

This confirms restoration of pre-language behavior and appearance at the source
level. No claim is made that every authenticated operational journey was retested.

## Customer implementation and files

The existing Customer implementation was reused without moving code or changing
authentication behavior:

- `apps/customer/index.ts`: stable Customer language provider.
- `apps/customer/App.tsx`: existing account-scoped language hook and auth selector.
- `apps/customer/src/components/LanguageSelector.tsx`: accessible English/తెలుగు
  radio controls with checked state, language hints and 44px minimum targets.
- `apps/customer/src/lib/language-storage.ts`: dedicated AsyncStorage adapter.
- `apps/customer/src/components/AuthControls.tsx`: password-reset selector.
- `apps/customer/src/CustomerSettingsScreen.tsx`: language preference controls.
- `apps/customer/src/components/CustomerTypography.tsx`: Telugu font loading and
  script-aware Text/TextInput handling alongside the existing Inter setup.
- `apps/customer/package.json`: existing Customer localization dependency retained.

The only Customer source file changed in this correction:

- `apps/customer/src/lib/auth-search.test.ts`: corrected the stale source
  assertion to require the existing customer-authorization guard and
  account-keyed `SavedItemsProvider` around `CustomerApp`. No authentication or
  session code was edited, and the guard assertion was not removed.

### Customer-only module changes

The existing `packages/localization` module is now consumed only by Customer.
Its generic workspace name is retained to avoid needless import/path changes.

- `package.json`: explicitly describes the package as Customer-only.
- `src/dictionaries.ts`: removed Vendor/Delivery/Admin namespace entries;
  central typed common/auth/customer keys remain.
- `assets/README.md`: documents Customer-only font use.
- `test/integration.test.ts`: checks Customer root/storage/control locations
  and forbids other portals from importing or rendering localization.
- `test/preference.test.ts`: retains persistence/race/isolation coverage;
  namespace-isolation test is now Customer-only.
- `test/provider.test.tsx`: removes the Dashboard-selector test/import; retains
  live language/account switching and no-remount/form/cart-count/navigation
  state checks.

Unchanged core files remain available for later Customer translation work:
`src/translation.ts`, `src/preference.ts`, `src/provider.tsx`, `src/index.ts`,
`tsconfig.json`, `test/fonts.test.ts`, font TTFs and their license.

Other files changed:
- `pnpm-lock.yaml`: removed dashboard localization linkage.
- `docs/ENGLISH_TELUGU_PHASE1_REPORT.md`: superseded-report notice.
- This report.
- Project memory scope/index: updated to Customer-only; unrelated memory retained.

## Selector locations

- Customer login and registration.
- Forgot-password flow: the surrounding auth-screen selector stays visible
  when the recovery form opens.
- Password-reset/recovery screen.
- Customer Settings.

Changing language updates translated controls immediately without logout,
application remount, clearing unsaved forms or changing navigation.

## Persistence

- English defaults for signed-out users and accounts without a saved selection.
- AsyncStorage prefix: `local-basket:customer:language:v1`.
- Independent signed-out and account-specific keys.
- Reopening the same app/device restores the saved preference.
- An account without a preference starts in English rather than silently
  inheriting another account's or the signed-out selection.
- Authentication/session keys are never read, written or cleared by this adapter.
- Invalid values fall back to English. Failed reads/saves expose localized
  warnings rather than silently claiming persistence succeeded.
- Revision checks ignore stale reads; ordered writes and per-key intent checks
  prevent delayed saves/errors from replacing newer choices.
- No cross-device synchronization or database-backed preference is claimed.

## Font implementation

Retained Customer-only assets:

- `packages/localization/assets/NotoSansTelugu-Regular.ttf`
- `packages/localization/assets/NotoSansTelugu-Medium.ttf`
- `packages/localization/assets/NotoSansTelugu-SemiBold.ttf`
- `packages/localization/assets/NotoSansTelugu-Bold.ttf`
- `packages/localization/assets/OFL.txt`

Static 400/500/600/700 weights load through existing expo-font support. Inter
remains the English font; Telugu and mixed-script Customer text/input content
selects the appropriate Telugu font. Colors, branding and layouts are retained.

TTF-table tests verify real nonzero Telugu, Latin, digit and ₹ glyphs and static
weight metadata. Customer export includes all four assets. A signed-out 320px
capture shows readable Telugu alongside English with no visible selector/form
clipping.

Physical Android/iOS font rendering, full Telugu help wrapping and authenticated
product-card/cart/settings layouts still require manual acceptance. No native
device test or automated browser acceptance is implied by the static capture.
The capture reported slow-network/font-loading notices; font assets are bundled,
not requested from Google at runtime.

## Verification results

| Check | Result |
| --- | --- |
| Customer localization foundation tests | **20 passed, 0 failed** |
| Existing relevant Customer tests | **68 passed, 0 failed** |
| Shared-library typecheck/build | Passed |
| Customer typecheck | Passed |
| Customer Expo web export | Passed |
| Dashboard typecheck, restoration safeguard | Passed |
| Dashboard Vite build, restoration safeguard | Passed; no Telugu assets |
| Pre-language dashboard source/CSS comparison | 9/9 exact matches |
| Customer/dashboard signed-out static mobile captures | Working |

Commands:

```sh
pnpm --filter @workspace/localization test
pnpm run typecheck:libs
pnpm --filter @workspace/customer run typecheck
pnpm --filter @workspace/dashboard run typecheck
pnpm --filter @workspace/dashboard run build
pnpm --filter @workspace/api exec tsx \
  --tsconfig ../../apps/customer/tsconfig.json --test \
  ../../apps/customer/src/lib/*.test.ts \
  ../../apps/customer/src/home-marketplace.test.ts \
  ../../apps/customer/src/marketplace-scrolling.test.ts
```

Customer export used its existing managed preview workflow and existing
environment setup. Both previews are running. The React test renderer emits an
upstream deprecation warning; it is a development-only test dependency.

## Remaining Customer-only work

After approval of the next phase, replace Customer-facing literals with reviewed
English/Telugu keys for:

- Home/store selection, search, categories and product-detail controls.
- Favorites/Saved Items, cart, checkout and delivery-option presentation.
- Orders, Reorder and displayed statuses.
- Settings, addresses, login/registration and password recovery.
- Validation, confirmations, empty/loading/error states and accessibility text.

Keep entered product/store/category/variant names and addresses untouched.
Translate interface labels around them, not the data itself. Retain canonical
status/request values, database values, prices, stock, historical snapshots,
auth/session behavior and delivery rules.

Manual review should include language changes while typing, refresh/reopen,
switching Customer accounts, mixed-script inputs, font weights and narrow
layouts. This phase stops here; other portals and deployment remain out of scope.
