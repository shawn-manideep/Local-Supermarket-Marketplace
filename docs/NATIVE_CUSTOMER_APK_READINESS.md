# Customer Android APK — implementation and readiness report

Verified on 2026-10-17 on `development/fresh-supabase-runner`.
This is a progress report, **not an APK release or end-to-end acceptance**.

## Existing implementation retained

- Customer: `apps/customer/`, Expo SDK 54, React Native 0.81.
- App: Apna Local Basket, version 0.1.0.
- Android package / iOS bundle: `com.apnalocalbasket.customer`.
- Scheme: `apnalocalbasket-customer`.
- EAS: owner `apna-local-basket`, project
  `7c05eb94-461f-4ca5-ba66-45aa8311cdc5`.
- `apps/customer/eas.json`: internal `preview` profile, Android `apk`,
  EAS environment `preview`. Configuration linkage is verified in files;
  live EAS account access was not reverified.
- Username/password login and ownership-verified mobile/password login already
  use server endpoints; email-dependent registration remains supported.
- AsyncStorage-backed Supabase sessions and native foreground token refresh
  already exist.
- Store/catalog discovery, product options, cart, addresses, checkout,
  history and status refresh already use real API routes.
- Order creation retains its server transaction, per-Customer advisory lock,
  row locking, authoritative prices and stock validation. No inventory or
  business-rule changes were made.

## Implemented corrections

1. Handle cold-start and warm native Auth callbacks on the exact
   `apnalocalbasket-customer://auth/callback` route. Only complete signup/recovery
   token pairs are accepted; Supabase still validates the credentials.
   Unknown routes and malformed/duplicate parameters do not grant access.
2. Native email signup requests that fixed callback. Native recovery opts in
   through `client: customer_native`. The API accepts this marker only for
   Customers and generates a fixed callback, never a supplied redirect.
   Existing web Origin enforcement, recovery throttling, generic confirmations,
   role checks and reset-password ownership checks remain.
3. Suppress interactive screens while a native callback is being processed;
   recovery opens only after successful authentication.
4. Native configuration rejects missing/non-HTTPS/local/workspace-preview API
   URLs and privileged Supabase keys. Web same-origin behavior is unchanged.
5. Add `check:native-config` and an `eas-build-post-install` safety hook.
   The preview gate checks public variables, approved app/project identities,
   APK profile and isolated Supabase target. This is a configuration check,
   **not proof of backend health, key authenticity or database identity**.

The API specification and generated client/validation types were regenerated.
No packages, SDK versions, app identifiers or Expo owner settings were changed.

## Infrastructure evidence

| Check | Result |
|---|---|
| Development `/api/health` | HTTP 200 after API restart; process health only |
| Customer and Dashboard workflows | Running; Customer web export succeeded |
| Existing backend database configuration | Still targets protected `gkwcolipeavxnuzqlamb`; not repointed |
| Published backend | Deployment discovery reports no active deployment or production URL |
| New Supabase project | `nrnigsznectrgbgafwme`, Mumbai, ACTIVE_HEALTHY, PostgreSQL 17.11 |
| New project's initial state | Read-only management-API SELECT: 0 public application relations, 0 non-extension public functions, 0 Auth users, 0 buckets, 0 storage objects, 0 custom Auth triggers |
| Migration history on new project | No Drizzle schema or Supabase migration-history table found |
| Managed baseline | Required roles and `auth.uid()` exist; pgcrypto available; expected managed schemas present |
| Full migration permissions / driver TLS and pooler compatibility | Not verified through the migration runner's actual connection |
| Offline migration inventory | PASS: 26 registered SQL files; no connection |
| EAS CLI / build | No installed EAS CLI found on PATH or in workspace dependencies; no cloud build started |

The new-project SELECT used the connected Supabase management service, not the
workspace PostgreSQL driver or protected project. It inspected counts/catalogs
only. It does not resolve or bypass the migration runner's connection safeguards.

Prior DNS diagnosis established that the direct database endpoint is IPv6-only
and Node's address-family-filtered lookup fails in this workspace. No unchanged
direct connection was retried. Obtain the **actual session-mode pooler** URL
from the new project's Connect panel; do not guess its hostname.

## Validation results

- Customer tests: **99 passed**.
- Focused backend account-access tests: **10 passed**.
- Shared library, Customer, API and Dashboard typechecks: **PASS**.
- OpenAPI/client generation: **PASS**.
- Android production bundle export: **PASS**, 771 modules, Hermes bundle.
- Customer web export: **PASS**, 492 modules.
- Signed-out mobile-width web screenshot: login screen renders. This is not
  authenticated or native-device acceptance.
- HTTP denial checks: web recovery without Origin remains 403; native Vendor,
  native Admin and arbitrary-redirect requests return 400 before database access.
- Current native build-variable gate: **BLOCKED as expected**; required public
  native build variables are not configured in the local environment.
- No real registration, password reset, checkout, stock race or phone session
  test has been performed against the new project.

## Required next steps, in order

1. Owner securely supplies only `FRESH_DB_URL` using the exact new project's
   **session-mode** pooler, database `postgres`, port 5432, username
   `postgres.nrnigsznectrgbgafwme`, no URL query options.
   Keep `FRESH_SUPABASE_URL` and existing application Secrets unchanged.
   Revalidate target identity, certificate/hostname verification, read-only
   transaction, timeouts, complete permissions and driver compatibility.
2. Present and obtain separate migration approval. The proposed command,
   **not executed**, is:

   ```sh
   pnpm --filter @workspace/db run migrate:fresh \
     --project-ref nrnigsznectrgbgafwme \
     --approve-project-ref nrnigsznectrgbgafwme \
     --apply
   ```

   This would execute the 26 registered SQL files and create the application's
   schema, policies, functions, triggers and migration tracking on the new
   project. It is not a production-data copy or authorization to create test
   accounts. History immutability, empty-target checks and protected-reference
   rejection remain mandatory.
3. Provision a separate HTTPS API environment using only the new project's
   backend credentials and approved isolated storage configuration. Do not
   repoint the existing running backend or reuse old storage objects.
4. Configure the new project's email confirmation/recovery delivery and allow
   the exact native callback URL. This report did not change provider settings.
5. Agree on test accounts and real test catalog/stock. An empty schema alone
   cannot support shopping. Never copy existing Auth users, records or files.
6. Configure EAS **preview**, not production:
   `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Use only the new public anon/publishable key.
   Database passwords, service-role keys, session and storage credentials stay
   server-side and must never use `EXPO_PUBLIC_*`.
7. Verify real authentication, session restore, role denials, discovery, cart,
   addresses, checkout, order history/status, error states and recovery against
   the isolated API. Do not claim success from rendered screens or health alone.
8. Once the EAS CLI is available, verify `eas whoami` and `eas project:info`
   from `apps/customer/`. If authentication is required, the owner runs
   `eas login`. Only after all readiness gates and approved Android signing:
   `eas build --platform android --profile preview`.
   Confirm EAS success and obtain its actual artifact URL before claiming an APK.

## Phone checklist — after an APK exists

- Install/open the downloaded APK; confirm the intended test environment.
- Register or use an approved Customer account; confirm email if required.
- Force-close/reopen to check session persistence; log out and sign in again.
- Browse approved stores/products; select exact selling options.
- Add/update/remove cart items; verify authoritative quantities and totals.
- Add/select a test address, complete an approved non-payment test order.
- Check order details/history and an approved Vendor/Partner status update.
- Verify insufficient stock and network/auth-expiry states.
- Test cold/warm recovery links, expired links and password reset.

No APK exists from this work. No iOS build, web publication, migration, fixture,
account creation, storage write or environment change occurred. No direct SQL
query or connection was issued against the protected database; the existing web
preview continues to use its original backend configuration.
