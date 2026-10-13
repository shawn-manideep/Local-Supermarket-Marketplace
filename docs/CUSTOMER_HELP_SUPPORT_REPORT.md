# Customer Help & Support — Implementation Report

## Access and navigation

Open **Account & Settings → Help & Support**. A help icon identifies the new
menu entry. The dedicated screen’s back button returns to Account & Settings,
and Account remains selected in the existing bottom navigation.

No unrelated Customer screen was redesigned.

## Functionality

- Search filters localized question text, answer text and category labels.
  It ignores case and surrounding whitespace and combines multiple search words.
- Five category cards filter actual topics: **Account & Profile**, **Order &
  Delivery**, **Payments & Refunds**, **Wallet Related**, **General Info**.
  Selecting the active card again clears that category filter.
- Ten FAQs expand/collapse using stable topic identities:
  tracking, delivery addresses, refunds, account details, scheduled delivery,
  missing/incorrect items, cancellation, payment methods, wallet availability
  and language preferences.
- Search and category filters combine. A helpful translated empty state and
  clear-filter action appear when there are no matches.
- **Chat with Us** and **Contact Us** show localized in-app notices explaining
  that their destinations are not configured. No message or ticket is simulated.
- FAQ answers accurately describe current capabilities: COD checkout, status
  history rather than a live tracking map, Placed-only Customer cancellation,
  immutable accepted-order addresses, and eligible future one-hour India-time
  scheduled slots. They do not promise refund approval/timing, replacement
  requests, online payments, wallet functionality or 24/7 assistance.

## English and Telugu

Added **40 English and 40 Telugu help strings** to the existing Customer
dictionaries: page/back/search labels, all categories, ten questions and answers,
support buttons/notices, counts, filter controls and empty states.

The page reuses the existing language selector, provider, saved account/device
preferences and Customer typography/font components. Customers can switch
English/Telugu on the Help screen; translated content updates immediately without
reinitializing the search, selected category, open FAQ or support-notice state.

Entered search text itself is not automatically translated. Search matches the
currently displayed language.

## Mobile and accessibility

The screen uses the existing viewport/container and scroll-content conventions,
including existing bottom padding. Category cards wrap in a two-column layout;
FAQ headings/counts and support buttons accommodate narrow screens and Telugu
labels. Main controls have at least 44px touch targets. Category selection and
FAQ expansion expose accessible states, and notices/empty results use polite live
regions.

## Exact files changed

### Application and tests

1. `apps/customer/App.tsx` — Help import, Account menu entry, screen navigation,
   back destination and Account-tab selection.
2. `apps/customer/src/HelpSupportScreen.tsx` — new screen, category filters,
   search, FAQ accordion, language selector and support notices.
3. `apps/customer/src/lib/help-support.ts` — stable categories/topics, search,
   FAQ-toggle logic and honest unconfigured-channel notices.
4. `apps/customer/src/lib/help-support.test.ts` — eight focused tests for
   navigation wiring, categories, search/empty results, FAQ expansion,
   English/Telugu coverage, support actions, factual answers and scroll/tap
   conventions.
5. `packages/localization/src/dictionaries.ts` — new bilingual Help strings.

### Documentation and durable project guidance

6. `docs/CUSTOMER_HELP_SUPPORT_REPORT.md` — this report.
7. `.agents/memory/customer-support-boundaries.md` — the user’s no-fictional-
   features/contacts/guarantees support-content constraint.
8. `.agents/memory/MEMORY.md` — pointer to that constraint.

No Vendor, Delivery Partner or Admin code was modified. No dependencies,
authentication logic, cart, inventory, order processing, delivery logic,
database schema or backend APIs were changed.

## Verification

| Check | Result |
|---|---|
| Customer regression and focused Help tests | **76 passed, 0 failed**; includes 8 new Help tests |
| Existing localization tests | **25 passed, 0 failed** |
| Shared-library typecheck | **Passed** |
| Customer typecheck | **Passed** |
| Customer Expo web export | **Passed**: 477 modules, 1.45 MB bundle |
| Existing Customer managed preview workflow | **Running after restart** |
| Public 390px preview capture | Sign-in screen renders; not signed-in Help acceptance evidence |

Commands:

```sh
pnpm --filter @workspace/api exec tsx \
  --tsconfig ../../apps/customer/tsconfig.json --test \
  ../../apps/customer/src/lib/*.test.ts \
  ../../apps/customer/src/home-marketplace.test.ts \
  ../../apps/customer/src/marketplace-scrolling.test.ts

pnpm --filter @workspace/localization test
pnpm run typecheck:libs
pnpm --filter @workspace/customer typecheck
```

The web export ran through the existing
`artifacts/marketplace-customer: web` managed workflow and exported to
`/tmp/phase12-customer-web`.

No automated browser journey tests were run, as requested. Focused tests verify
pure behavior and component/navigation wiring; signed-in click-through acceptance
remains manual. The public preview capture logged a resource 404 while still
rendering the sign-in screen. No matching reference screenshot was attached with
this request, so the page follows the written layout and existing Customer theme.

## Configuration still needed

No central marketplace chat integration, support phone number or support email
was found in the existing application. A genuine chat/support destination must
be supplied and configured before these buttons can initiate external assistance.
Until then, both actions explicitly show their unavailable/configuration status.

## Manual acceptance checklist

1. Sign in, open Account & Settings → Help & Support, then use Back and confirm
   Account remains selected.
2. Select each category; confirm relevant topics appear. Select it again or clear
   filters to restore the complete list.
3. Search a question or answer phrase; verify matching results and the empty state
   for an unmatched query. Try Telugu search after changing the language.
4. Expand/collapse an FAQ and switch languages on the same page. Verify titles,
   questions, answers and notices update while state remains intact.
5. Tap both support buttons; verify truthful localized configuration notices,
   without an invented destination or sent-message claim.
6. At 320–414px widths, scroll through the last support message and confirm the
   bottom navigation does not cover it.

The application was **not deployed or published**.
