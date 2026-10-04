# Phase 9 — End-to-end QA and release readiness

**Project:** Local Supermarket Marketplace  
**Assessment date:** 2026-10-04  
**Decision: NOT RELEASE READY**

The tested commerce and delivery paths passed. This is not a certification of
signed-in browser behavior, production credentials, or an issue-free dependency
tree. The unresolved release gates are listed in section 21.

## 1. Scope

Treated the approved Phases 1–8 implementation as a release candidate.
Executed all existing non-browser test suites, both explicit live-development
suites, a complete HTTP business journey, build/contract checks, security scans,
source-level authorization review, and read-only development integrity checks.

No automated browser journeys, Playwright runs, feature additions, architecture
redesign, new Admin Portal, deployment, DNS/domain change, production migration,
or production-data modification were performed.

No application runtime code, API contract, schema, approved migration, stock
rule, authentication design, or portal presentation was changed. Added only
the development QA harness `scripts/src/phase9-release-qa.mjs` and this report.
The harness refuses other Auth targets, requires explicit opt-in and PostgreSQL
17, and confines its commerce fixtures to disposable loopback PostgreSQL.

## 2. Environment

- Node.js 24.13.0; pnpm workspace.
- Development Supabase project: `supermarket-marketplace-dev`, healthy,
  region `ap-south-1`, PostgreSQL 17.6.
- Default local PostgreSQL binaries are 16.15. Full migration replay used
  PostgreSQL 17.6 explicitly; existing subset integration suites passed with
  their own disposable clusters.
- Customer preview: `/customer/`; Vendor/Partner preview: `/` and
  `/delivery-partner`; shared API: `/api`.
- All four existing managed workflows were running with no new runtime crashes.
- Publishing metadata was checked read-only: **not deployed**.
- Existing development identity credentials were consumed by test code only;
  no credentials, tokens, addresses, or personal account details are included
  in this report.

## 3. Automated test results

| Run | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Default API suite | 194 | 0 | 2 |
| Explicit live Auth/HTTP suite | 13 | 0 | 0 |
| Explicit live Master Catalog suite | 1 | 0 | 0 |
| Customer suite | 48 | 0 | 0 |
| Dashboard/Vendor/Partner suite | 20 | 0 | 0 |
| **Verified passing Node test count** | **276** | **0** | **See below** |

The default suite's two opt-in skips were:

1. `live-auth.integration.test.ts`: requires
   `RUN_PHASE6_AUTH_INTEGRATION=1`; executed separately and passed.
2. `acceptance.integration.test.ts`: requires
   `RUN_MASTER_CATALOG_INTEGRATION=1`; executed separately and passed.

**No existing skipped test remains unexecuted.** The catalog Node test contains
**161 passed acceptance assertions, zero failed**. The new HTTP QA harness
contains **28 passed named checkpoints, zero failed**. These assertion/checkpoint
counts are not added to the 276 Node-test count.

Commands:

```sh
pnpm --filter @workspace/api run test
RUN_PHASE6_AUTH_INTEGRATION=1 pnpm --filter @workspace/api exec tsx \
  --test src/delivery-partner/live-auth.integration.test.ts
RUN_MASTER_CATALOG_INTEGRATION=1 pnpm --filter @workspace/api exec tsx \
  --test src/master-catalog/acceptance.integration.test.ts
pnpm --filter @workspace/api exec tsx --test \
  ../../apps/customer/src/lib/*.test.ts ../../apps/customer/src/*.test.ts
pnpm --filter @workspace/api exec tsx \
  --tsconfig ../../apps/dashboard/tsconfig.json \
  --test ../../apps/dashboard/src/*.test.tsx
```

The first dashboard invocation omitted its JSX configuration and failed three
render tests with `React is not defined` (17 passed, 3 failed). Using the
dashboard's existing TypeScript configuration gave 20/20 passes. This was a
runner error, not a hidden failure or an application code fix.

## 4. Integration test results

### Existing integration coverage

The default suite includes real disposable-database inventory, partner
foundation, and delivery-workflow tests, including migration constraints,
rollback, authorization, RLS, uniqueness and concurrency. The two live suites
exercise actual development Supabase Auth and actual Express HTTP endpoints.

The live Auth suite created temporary identities and removed them. The live
catalog suite created new QA catalog records, archived its generated master
records, and deactivated generated vendor listings through normal APIs. It
verified its pre-existing commerce/catalog row snapshots remained unchanged.
It deliberately does not hard-delete catalog/history.

### Complete business journey

`scripts/src/phase9-release-qa.mjs` used existing Customer A/B, Vendor B and
`deliverytest1` development identities with real Supabase session verification.
It replayed all 15 SQL migrations on an empty local PostgreSQL 17 database,
seeded only isolated prerequisites, and drove the business journey through
normal application APIs:

1. Missing/invalid protected-session denial.
2. Customer address creation and saved-pincode store discovery.
3. Vendor master-product selection and duplicate reuse.
4. Vendor mixed-unit variant configuration and availability.
5. Category-free rice/milk/eggs/apple/empty-result searches.
6. Customer details and exact selected-variant cart submission.
7. Unavailable variant and cross-customer mutation denial.
8. Checkout validation and two concurrent identical checkout requests.
9. Vendor ACCEPT → PREPARE → READY.
10. Partner username/password login and vendor assignment.
11. Partner ACCEPT → PICKUP → START → DELIVER.
12. Customer reads READY → OUT_FOR_DELIVERY → DELIVERED from existing order API.
13. Repeated delivery denial.
14. Current vendor price change and customer Buy Again.
15. Historical receipt preservation and no reorder stock deduction.

**28 named checkpoints passed.** No production commerce was contacted and no
managed development cart, order, stock, or assignment was mutated by this
harness. Local fixtures were destroyed with the disposable cluster.

Example invocation in this workspace:

```sh
PATH=/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin:$PATH \
  RUN_PHASE9_QA=1 node scripts/src/phase9-release-qa.mjs
```

Use the installed PostgreSQL 17 binary directory appropriate to the environment;
do not reuse that Nix path on a different machine.

## 5. Authentication results

- Live Customer A/B and Vendor B email/password authentication passed.
- Temporary customer/vendor/backend-admin email/password sessions resolved
  authoritative roles through `/api/auth/me`.
- Delivery Partner uppercase username login passed using the existing
  Supabase session architecture.
- Invalid password/unknown username responses remain generic.
- Missing/invalid tokens cannot read protected orders.
- Partner deactivation immediately denied its existing operational session;
  reactivation and logout behavior passed.
- Existing username validation covers 3–30 characters, leading ASCII letter,
  allowed characters, reserved names, case-insensitive uniqueness and immutable
  username. Public application tables have **zero password-named columns**.
- Logout/session clearing is covered by the live Auth suite and source review.
  Signed-in browser account-switching acceptance remains on the manual checklist.

**Vendor A qualification:** the live catalog suite reported that its existing
saved password received `invalid_credentials` and used its already-implemented,
exact-identity development magic-link fallback. Its catalog authorization passed,
but **Vendor A password login did not pass this assessment**. No password was
reset, no identity was replaced, and the application login architecture was
not changed. This is a development credential readiness gap, not proof that
email/password authentication is universally broken.

## 6. Customer results

Passed API/unit/source-contract coverage for store discovery, category-optional
search, details, mixed-unit variants, selected identity, quantity, contextual
cart, one-store conflicts, current server prices, checkout, order history,
Buy Again, Home/history presentation, navigation context, and web layout bounds.

The HTTP journey exercised actual shopping, order creation, delivered-order
visibility and reorder without client-owned pricing or stock.

API projections omitted exact stock. Unavailable options were not purchasable;
cross-customer cart/address/order access was denied. Historical reorder identity
does not substitute another product, variant or store.

The harness searched rice, milk, eggs and apple; only its isolated Rice fixture
had matching catalog data. This verifies query/error/empty-response handling,
not relevance against a production assortment.

Wheel/trackpad/touch scrolling, final-row clearance, dialogs, back-navigation
interaction, loading/API-failure visuals and signed-in persistence are not
claimed as browser-verified.

## 7. Vendor results

Passed catalog and vendor regression coverage for:

- Global master search and add-to-store; duplicate listing reuse.
- Store-specific price/stock/variant configuration and activation.
- Archived-master rejection and protection of existing catalog identities.
- Cross-vendor availability/stock/configuration denial with unchanged child rows.
- Owned-store order list/details and historical receipt rendering.
- ACCEPT → PREPARING → READY legal transitions, permitted rejection,
  illegal skips, duplicate actions, and protected snapshots.
- ACTIVE partner eligibility and READY-only assignment.
- Explicit denial of vendor dispatch/completion overrides.

Vendor B participated in the complete real-authenticated HTTP journey.
Vendor A's catalog checks passed under the qualified session noted in section 5.

## 8. Delivery Partner results

Passed username login, own-profile/dashboard, active-status enforcement,
own-assignment scoping, request validation and cross-role denials.
The full HTTP journey exercised the existing development partner's normal login
and actual assignment/action endpoints with local commerce.

Existing integration tests verify another partner cannot access/act on the
assignment, inactive/nonexistent/wrong-role assignees fail, and the partner
receives only fulfillment-required order/address projections.

## 9. Inventory results

The actual checkout API changed **10 → 7** for a quantity-three order.
Concurrent duplicate checkout returned one order and deducted once.

Existing real-database regression tests passed:

- Zero/insufficient stock rejection and nonnegative stock constraints.
- Independent concurrent customers cannot oversell.
- Many concurrent orders cannot consume more than starting stock.
- Failed multi-line deduction and subsequent order-write failure roll back.
- Idempotent checkout and intent mismatch handling.
- Permitted cancellation/rejection restores stock exactly once, including
  concurrent restoration.
- Authoritative revisions protect stale vendor stock forms.

Every delivery action in the full HTTP journey left stock at 7. Buy Again also
left stock at 7; it creates a cart, not another order.

## 10. Order lifecycle results

Checkout created one persisted order, selected-variant item, current-price
snapshot and initial history, and converted the active cart.
The duplicate request returned the same order identity.

The HTTP journey changed the current variant price from 70 to 85; Buy Again used
85 while the complete historical receipt remained byte-for-byte equal at the
API-object level. Unit/database tests also cover protected product/variant/store
identities, commercial snapshots, legal actions and transactional rollback.

The new harness checked cross-customer order denial and customer denial of
vendor preparation actions. Existing store-scoping regressions cover cross-vendor
orders and writes.

## 11. Delivery lifecycle results

Passed:

`PENDING → ACCEPTED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED`

Pickup requires acceptance, start requires pickup and completion requires
out-for-delivery. Acceptance/pickup leave the order READY. Start/completion use
the existing order/history model and do not affect inventory.

Existing tests cover pending rejection/reassignment, accepted-duty replacement
denial, one active assignment, concurrent assign/accept/pickup/start/completion,
repeated completion, and forced history-write rollback.

Customer response checkpoints omitted partner/assignment identities while
showing the same persisted order status. No second tracking model was added.

## 12. Security/authorization results

### Endpoint/source review

Reviewed existing auth, customer management, marketplace, cart, order/reorder,
vendor catalog/master selection, and partner assignment/action boundaries.
Roles come from database profiles after Supabase token validation. Store/customer/
partner scope comes from the authenticated actor, not submitted ownership claims.
Strict schemas reject unsupported client prices, roles, statuses and inventory.
Mutations revalidate ownership and critical state inside transactions.

Passed denial tests are supported by state assertions, not only status codes:
cross-customer cart mutation left quantity unchanged; existing cross-vendor and
partner regressions verify unchanged parent/child/history state.

### Automated scanners

| Scanner | Status | Findings |
|---|---|---|
| Dependency audit | Completed | 0 critical, 8 high, 3 moderate, 0 low |
| Static code scan | Completed, not incomplete | 4 scanner-labelled critical findings |
| Privacy/dataflow scan | Completed | 0 findings |

The four static warnings point to `scripts/src/master-catalog-cdp.mjs`, at the
parameterized QA queries around lines 47, 48, 53 and 114. Reviewed each:
request-like values are query parameters; interpolated snapshot table names
come from internal fixed table lists, not browser/client input. This is an
offline QA helper, not an Express endpoint. **No exploitable SQL-injection path
was demonstrated; these four scanner findings are triaged as false positives
for the reviewed call sites.** The helper was not run as a browser journey.

Dependency findings:

| Package/version | Severity/count | Main path/exposure | Recommendation |
|---|---|---|---|
| brace-expansion 5.0.9 | High ×2, moderate ×1 | Expo/codegen glob tooling | Compatible parent update or patched 5.x after validation |
| braces 3.0.3 | High ×1 | Metro/fast-glob tooling | Review upstream fix/parent replacement |
| image-size 1.2.1 | High ×2 | Metro asset processing | Requires compatibility review; scanner fix is 2.0.3 |
| js-yaml 4.3.1 | High ×1 | Orval/build tooling | Compatible 4.3.2 update |
| node-forge 1.4.0 | High ×1 | Expo code-signing tooling | Review upstream signature-verification fix |
| uuid 7.0.3 | High ×1 | Expo/xcode tooling | Fix requires major-version compatibility review |
| esbuild 0.18.20 | Moderate ×1 | Drizzle tooling | Update parent; production API uses 0.28.2 |
| fast-uri 3.1.7 | Moderate ×1 | OpenAPI validation tooling | Compatible 3.1.8 update |

The inspected API request handlers do not feed customer inputs to these glob,
image, YAML or code-signing tools. Exported web clients do not serve Metro/Expo
CLI to customers. **This does not eliminate build-chain risk or justify claiming
the dependency scan is clean.** No speculative/breaking package upgrade was
made in this QA phase. Remediation or explicit scoped risk acceptance is required
before release.

### Development database security

- All public application tables have RLS enabled.
- Live privilege review confirms raw orders/items/history/carts/products are not
  table-readable by `authenticated`.
- An attempted read-only customer-role raw variant-stock query was denied by
  the required categories-table privilege; no exact stock values were returned.
- Variant write grants alone do not establish a bypass: the policies depend on
  store/product scope. The existing database tests exercise their denial rules.
- Direct public customer/partner writes are not used by the application.

Supabase security advisor warnings:

1. Mutable search path on the invoker trigger `set_updated_at`.
2. Five authenticated-executable SECURITY DEFINER helpers. These are intentional
   RLS identity/eligibility helpers, with constrained bodies/search paths and no
   commerce write API; do not revoke blindly and break RLS.
3. Leaked-password protection disabled in development Auth.

References:
- https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Production equivalents need review before Phase 10. No Supabase configuration
or function/migration was changed here.

## 13. Data integrity results

Read-only checks ran on the confirmed development database before/after live
testing. Counts:

| Check | Violations |
|---|---:|
| Orphan orders / order items | 0 / 0 |
| Invalid assignment references or partner roles | 0 |
| Duplicate active assignments | 0 |
| Negative variant / legacy product stock | 0 / 0 |
| Invalid customer/store-owner/partner role relationships | 0 |
| Partner role without partner profile | 0 |
| Duplicate case-insensitive usernames | 0 |
| Unvalidated public foreign keys | 0 |
| Orders missing items / status history | 0 / 0 |
| Order-item store or variant identity mismatch | 0 |
| Cart-item store or variant identity mismatch | 0 |
| Active/completed assignment inconsistent with order state | 0 |
| Public password-named columns / tables without RLS | 0 / 0 |
| Known legacy OUT_FOR_DELIVERY order without assignment | **1, unchanged** |

Pre/post whole-table fingerprints:

| Table | Before rows | After rows | Fingerprint |
|---|---:|---:|---|
| orders | 26 | 26 | Identical |
| order_items | 43 | 43 | Identical |
| order_status_history | 84 | 84 | Identical |
| delivery_assignments | 4 | 4 | Identical |
| user_profiles | 15 | 15 | Identical |
| product_variants | 73 | 81 | Expected new catalog QA records |

Eight new catalog-suite variants remain under its deactivated test listings.
The suite's own per-existing-row snapshots passed with 161/161 assertions and
zero cleanup failures. Their addition is disclosed, not described as an
unchanged entire catalog. No pre-existing commerce/history was rewritten.

## 14. Responsive/manual QA checklist

**All Phase 9 browser checks below are pending user execution.**
Prior manual acceptance of Phases 1–8 is respected, not falsely relabelled as
new Phase 9 browser evidence.

Use normal portal controls and one **new** order for the full chain. Do not use
the legacy unassigned dispatched order. Do not bypass normal APIs or alter
database state to force an expected screen.

### Customer

1. **Login:** valid email/password works; invalid credentials are clear and
   protected content is not shown before authentication.
2. **Home:** approved shopping sections load; loading and empty states recover.
3. **Store selection:** saved-address eligibility is respected and store context
   stays visible.
4. **Search:** rice/milk/eggs/apple work without choosing a category; empty results,
   store context and recoverable API failure are clear.
5. **Product Details:** open from search/store and return to the same context.
6. **Variants:** single-option convenience works; multi-option products require
   explicit choice; mixed units are not converted; unavailable choices are blocked.
7. **Cart:** add/increase/decrease/remove; Continue Shopping retains context;
   cross-store decline preserves the old cart, confirmation replaces it explicitly.
8. **Checkout:** saved fulfillment details and server totals are correct; duplicate
   submission does not create a second order.
9. **Order:** correct product/variant/quantity/prices/address/timeline; another
   customer's order cannot be read.
10. **Reorder:** exact historical identities use current price/availability;
    unavailable originals are explained; no substitution or automatic placement.
11. **Active order:** the new order remains discoverable through Home/order history.
12. **Delivery status:** READY → OUT_FOR_DELIVERY → DELIVERED matches vendor/partner
    actions; no internal partner/assignment IDs or exact stock shown.
13. **Logout:** protected content disappears; logging into another customer never
    shows the prior user's cart, address, order or reorder history.
14. **Mobile/tablet/desktop:** repeat relevant shopping screens at approximately
    **390×844, 1024×768 and 1440×900**. Without resizing/zooming, wheel/trackpad/
    scrollbar/touch reaches the final product row; category strip remains
    horizontal; details/cart/checkout/status are accessible; cart bar does not
    cover final actions; no horizontal overflow.

### Vendor

15. **Login:** normal email/password, invalid-session handling and logout/relogin;
    resolve the Vendor A saved-credential gap separately.
16. **Product management:** own-store master selection, duplicate reuse, variant
    configuration and availability; another store's edits are denied.
17. **Stock:** update own stock; zero/insufficient stock is correctly represented;
    stale updates are rejected rather than overwriting checkout deductions.
18. **New Orders:** the customer's new order appears with historical receipt and
    necessary fulfillment information.
19. **Accept:** accept the PLACED order; permitted rejection needs confirmation.
20. **Preparing:** ACCEPTED advances only to PREPARING.
21. **Ready:** PREPARING advances only to READY; no vendor dispatch/completion.
22. **Assign Partner:** ACTIVE partners appear; assign one to the new READY order;
    inactive/wrong-role/cross-store targets fail.
23. **Delivery progress:** accepted/picked-up/out-for-delivery/delivered updates
    appear after the existing refresh/poll mechanism.

### Delivery Partner

24. **Login:** username/password works, including accepted case normalization;
    incorrect and unknown credentials have generic denial.
25. **Dashboard:** only this partner's work and metrics are shown.
26. **New assignment:** assigned duty appears after refresh/poll with necessary
    fulfillment information only.
27. **Accept Duty:** accept own PENDING assignment once.
28. **Reject Duty:** on a separate new READY order reject PENDING duty; order stays
    READY; vendor can explicitly assign another ACTIVE partner.
29. **Pickup:** allowed only after acceptance; order remains READY.
30. **Start Delivery:** allowed only after pickup; customer sees OUT_FOR_DELIVERY.
31. **Mark Delivered:** allowed only after start; all roles see DELIVERED; repeated
    completion has no duplicate effects and inventory is unchanged.
32. **Own-assignment isolation:** another partner's list/detail/actions are denied.
33. **Logout:** cached protected content disappears; reauthentication uses the
    intended account only.

### Cross-role

34. Customer cannot access Vendor controls.
35. Customer cannot access Partner controls.
36. Vendor cannot perform Partner-only delivery controls.
37. Partner cannot access Vendor catalog/stock/order controls.
38. Partner cannot read or mutate another partner's assignment.
39. Vendor cannot read or mutate another vendor's order/assignment.
40. Customer cannot read or mutate another customer's order.

## 15. Known legacy development data

Exactly one pre-existing order is OUT_FOR_DELIVERY with no assignment.
Its dedicated pre/post fingerprint was identical:
`db55d7b70e84e22d9be1b5dc970f8844`.

It was not backfilled, reassigned, completed or changed. READY-only assignment
and partner-only completion intentionally do not repair this state automatically.
It must not be used as the new lifecycle test order.

If it needs to become actionable, a separately approved development cleanup is
required. It is not a regression in new-order creation or delivery.

## 16. Defects/findings found

### HIGH — existing Admin frontend conflicts with stated product scope

- **Area:** `apps/dashboard/src/App.tsx`.
- **Evidence/root cause:** existing admin-role branch renders the legacy
  `AdminStorePanel` and `AdminDeliveryPartners` workspace, including an
  Administration navigation. These imports/branches predate this phase.
- **Impact:** the statement “There is NO Admin Portal” is not true of the current
  reachable frontend, even though customer/vendor/partner authorization passed.
- **Recommended correction:** explicitly approve removing/disabling that existing
  frontend branch while preserving administrative backend capabilities. Do not
  create another portal or expose provisioning to vendors/customers.
- **Status:** unresolved scope discrepancy. No Admin Portal was added and no
  accepted pre-existing management UI was silently deleted during QA.

### HIGH readiness gap — Vendor A saved password does not authenticate

- **Area:** dedicated development QA account.
- **Root cause observed:** Supabase returns `invalid_credentials` for the saved
  Vendor A test secret; exact reason for its mismatch was not established.
- **Impact:** magic-link catalog acceptance does not certify its required normal
  email/password login.
- **Recommended correction:** separately authorize reconciliation of the saved
  development secret/account password, without replacing identity or changing
  auth architecture; rerun normal Vendor A login afterward.
- **Status:** unresolved; no credential/account reset performed.

### HIGH dependency findings — build/tool chain

Eight high advisories remain as listed in section 12, including packages without
a scanner-provided compatible fix. No customer-request exploit was demonstrated.
Resolve affected parent packages with focused compatibility tests or approve
documented, environment-limited exceptions before release. Do not equate the
passing functional suite with a clean security audit.

### Verification-only failures, resolved

- Dashboard JSX runner configuration: initial three failures, corrected invocation.
- Full SQL replay initially used local PostgreSQL 16, which cannot parse the
  PostgreSQL 17 MAINTAIN privilege; replay switched to target-compatible 17.
- The local Supabase-like bootstrap needed the `postgres` role for existing
  default-privilege statements; added only inside the disposable cluster.
- The initial QA harness omitted required `paymentMethod: "COD"` during checkout
  validation; corrected the harness request to the existing contract.

These were visible QA setup/request mistakes, not application defects or skipped
tests. Final replay/journey passed.

### LOW observations

The static signed-out Customer snapshot rendered correctly at 1440×900 and
reported one resource 404 plus the existing password-input/form advisory.
The failed resource URL was not identified by the capture log. These are not
proof of a signed-in workflow failure; retain for manual inspection rather than
claiming a clean browser console.

## 17. Defects fixed

**No approved application-workflow defect was established by the executed
tests, so no application runtime fix or migration was made merely to produce
changes.**

Corrected only QA invocation/bootstrap/request mistakes described above.
The new reproducible harness supplies additional full-chain API checkpoints.
There are no application fixes requiring a new defect-specific regression test.
Existing regressions and the new journey all passed.

## 18. Remaining limitations

### Lightweight performance/UX review

Source review found bounded 45-second Customer order-status and Vendor order
polling, effect cleanup/abort handling, request-generation guards against stale
responses, debounced search, and explicit catch/finally handling for principal
marketplace/order loading requests. The reviewed paths did not show an obvious
unbounded render/request loop. Running workflows and the non-browser journey
did not report a new runtime crash.

This is not load testing, a network-request trace, or signed-in UX acceptance.
No latency target was supplied or certified; duplicate visual fetches, long
user-visible waits, loading/empty/error presentation and console behavior remain
part of manual inspection. No speculative optimization was performed.

### Verification limits

- Phase 9 signed-in/responsive/manual checks are pending, not automated.
- Full-chain commerce used an isolated schema with real development Auth, not
  newly written managed-development orders. Live catalog and Auth suites ran
  separately against the managed development database.
- Broad existing regression coverage mixes unit/source-contract tests and real
  database/HTTP tests. Source assertions are not presented as browser evidence.
- No synthetic expired signed JWT was manufactured; actual invalid/missing-token,
  deactivated-account and logout behavior passed. Expiry UX remains manual.
- Portal updates use the existing polling/manual refresh, not instantaneous
  external tracking.
- Legacy dispatched order remains deliberately untouched.
- Dependency/advisor findings, Vendor A credential qualification, Admin frontend
  scope mismatch and repository hygiene remain disclosed.
- No statement is made that all historical Git commits are secret-free or that
  a remote branch has been reviewed; see section 20.

## 19. Build results

| Validation | Result |
|---|---|
| Full workspace typecheck | Passed |
| Marketplace API TypeScript build (`@workspace/api`) | Passed |
| Production artifact API bundle (`@workspace/api-server`) | Passed |
| Dashboard production Vite build | Passed, 100 modules |
| Customer Expo web export | Passed, 297 modules using warm cache |
| OpenAPI validation | Passed, OpenAPI 3.1, zero validation errors |
| Existing generated client/Zod contracts | Included in passing workspace typecheck |
| QA harness syntax | Passed |
| Diff whitespace | Passed |

Production API bundle was started temporarily in **this development container**
and then stopped. `/api/healthz` and `/api/health` returned 200; protected
customer/vendor/partner endpoints returned 401 without tokens. This is a local
build smoke test, **not a production deployment**.

No API contract changed, so no regeneration was needed. The semantic OpenAPI
validator and generated-package typechecks passed without rewriting generated
files.

The production API bundle has an informational size warning. No build failed.
Existing managed preview workflows remained running; application runtime was
unchanged, so no unnecessary restart/export cycle was performed.

## 20. Production readiness review

### Repository and credentials

- Current remote: `shawn-manideep/Local-Supermarket-Marketplace`; branch: `main`.
  These were observed, not certified as the owner's intended release branch.
  No GitHub write, push or remote branch change was made.
- Scanned 594 tracked files for private keys, common secret tokens,
  credential-bearing database URLs and quoted password/secret assignments.
  Candidates were confined to synthetic test fixtures; no live secret was
  established by that targeted scan.
- `.env` files are ignored; `.env.example` documents key names without values.
- The scan is not an exhaustive historical secret audit. Verify remote/history
  separately before production; do not infer “no historical secret” from current
  file scanning.
- Tracked screenshots, catalog verification outputs and old browser QA scripts
  exist. Review packaging/public exposure and approve retention/removal. They
  were not deleted automatically or used for automated browser journeys.

### Environment

Client configuration is configurable through `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_API_URL`.
Server configuration needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ALLOWED_ORIGINS`, and the
hosting `PORT`. Use only publishable client credentials; database/service keys
remain server-only.

Development public Supabase variables are development-scoped. Server secrets
appear available to the production scope through inherited/shared existence.
Their values were not inspected, and **this does not verify production target
separation**. No production public Supabase/API configuration was confirmed.
Do not publish with inherited development database credentials.

Production artifact commands build the real marketplace API and existing
frontends. `/api/healthz` is available in the production API bundle. Static
frontend API origin/base-path/CORS configuration must be chosen for the eventual
approved deployment topology; Vite's local development proxy is not a production
API routing plan.

### Migration review and Phase 10 plan (not executed)

All 15 checked-in SQL migrations replayed successfully, in filename order, on
an empty isolated PostgreSQL 17 schema. Remote Supabase history contains the
corresponding applied development migrations, with the final
`delivery_workflow` entry corresponding to `0014_delivery_workflow.sql`.

The schema additions are ordered: base/RLS protections → variants and approved
legacy variant backfill → master catalog → inventory → partner enum → partner
foundation → delivery workflow. Constraint/policy replacement and the older
explicit backfill are intentional; no accidental DROP TABLE or data-wipe
migration was introduced by this phase.

Before any separately authorized production migration:

1. Confirm production project identity and PostgreSQL 17 compatibility;
   take an approved backup and inspect its existing migration ledger.
2. Use the established Supabase history; never blindly replay the Drizzle
   journal against an already-created schema.
3. Apply only reviewed unapplied migrations in order. The partner enum migration
   must commit before subsequent statements consume its value.
4. `0014` requires an empty delivery foundation and must not be replayed over
   existing assignment data. Do not clear data to satisfy it.
5. Review older explicit variant backfill and existing legacy states for that
   production target; do not silently repair or rewrite historical orders.
6. Verify production row preservation, privileges/RLS, scoped auth, snapshots,
   checkout concurrency and the normal delivery chain after the approved change.

**No migration was applied to production or to the managed development schema
during Phase 9.** Full replay occurred only inside disposable local PostgreSQL.

### Exact Phase 10 prerequisites

- Resolve/approve the Admin frontend scope discrepancy.
- Reconcile and verify Vendor A's normal development password login.
- Complete and record all 40 manual checks, including all three responsive sizes.
- Remediate or explicitly approve scoped dependency/advisor risk exceptions.
- Confirm intended repository/release branch and repository/history hygiene.
- Approve production hosting topology, server/client API configuration and CORS.
- Provision/verify distinctly scoped production Supabase variables/secrets;
  exclude development QA credentials and prevent development DB inheritance.
- Approve backup, ledger-specific migration procedure and production smoke plan.
- Obtain explicit authorization to start Phase 10. None was obtained or assumed.

## 21. Final decision

### NOT RELEASE READY

**No new checkout, inventory, authorization, snapshot or delivery-lifecycle
BLOCKER was reproduced in the executed tests.** That positive result does not
close the following release gates:

| Gate | Affected area / root cause | Required action |
|---|---|---|
| HIGH product-scope discrepancy | Existing reachable Admin frontend contradicts no-Admin-Portal scope | Explicit decision and approved minimal frontend correction |
| HIGH credential readiness gap | Vendor A saved password rejected; test uses magic-link fallback | Approved credential reconciliation and normal login rerun |
| Security sign-off pending | 8 high and 3 moderate build/tool dependency advisories; advisor warnings | Focused remediation or documented scoped acceptance |
| Manual acceptance pending | Browser journeys intentionally not automated | Complete checklist 1–40 at required sizes |
| Production prerequisites pending | Target configuration, migration ledger/backup and release-branch review not yet approved | Complete Phase 10 prerequisites before deployment |

The known legacy unassigned dispatched order is a separately documented
development exception, not counted as a newly introduced regression.

**Stopped after this Phase 9 report. Phase 10 was not started. No deployment,
production modification, automatic legacy cleanup or new Admin Portal.**