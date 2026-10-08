# Vendor Documents: ReplShield Redirect Diagnosis

## 1. Cause and evidence

The supplied browser Network evidence identifies the failed request as
`GET /api/vendor/documents`, receiving HTTP **307 Temporary Redirect** to
`https://replit.com/_replshield/...`.

Documents explicitly set `credentials: "omit"`, suppressing browser cookies.
Working Vendor requests use the existing `apiRequest` helper and fetch's default
`same-origin` credential policy. This discrepancy excludes the browser's
development-preview protection cookies from Documents requests even though
their Supabase bearer Authorization header is present.

The protection redirect is not the Documents API's JSON response. A background
fetch redirected to the off-origin protection flow cannot reliably complete it
as an API call; the browser surfaces the observed `Failed to fetch`.

Official Replit documentation was consulted for development-preview/protection
behavior:

- https://docs.replit.com/core-concepts/project-editor/app-setup/development-urls
- https://docs.replit.com/help/networking-and-app-errors

The browser's private cookies/headers were not collected. The 307 evidence is
user-supplied; no automated browser session was driven to reproduce or clear
the protection challenge.

## 2. Where the redirect originates

The Documents route performs bearer/role authentication and returns document
status JSON. Neither it nor its status service issues a redirect. Its requested
path exactly matches the mounted route, without a trailing-slash normalization.
The off-origin `replit.com/_replshield` destination is the development proxy's
protection flow, not an application redirect.

Previous live development HTTP checks using a real Vendor session returned 200
for both `/api/vendor/store` and `/api/vendor/documents`, through the proxy and
directly against the API. The correct store was resolved. Documents returned
seven declared types, no current uploaded documents, and 0/4 completion.
No Documents backend exception was observed.

## 3. Request comparison

| Property | Working Vendor profile/orders | Documents before fix |
|---|---|---|
| Example path | `/api/vendor/store`, `/api/vendor/orders?pageSize=50` | `/api/vendor/documents` |
| API URL resolution | Existing `apiUrl` helper | Same `apiUrl` helper |
| Base URL | `VITE_API_URL`, otherwise relative same-origin path | Same; no second base |
| Host/protocol | Development preview HTTPS origin in current configuration | Same |
| Bearer header | Existing `apiAuthorizationHeaders` | Same |
| Cookies | Default same-origin cookie policy | Explicitly omitted |
| Origin/Referer | Browser-generated; no caller override | No caller override |
| Redirect policy | Fetch default `follow` | Same |
| JSON client | Existing `apiRequest` | Custom raw fetch |

The established configuration difference is credentials/client usage, not
hostname, API base URL, bearer-header construction or route normalization.
Expired/blocked preview cookies can still require the browser's normal preview
authentication flow; the fix does not bypass that protection.

## 4. Small targeted fix

Only application source changed:

`apps/dashboard/src/VendorDocumentsPanel.tsx`

- `loadStatus()` now uses the **existing**
  `apiRequest<VendorDocumentStatus>("/api/vendor/documents", token)`.
- Raw upload and binary-view fetches now set `credentials: "same-origin"`,
  matching the working client while preserving File/Blob handling.
- Bearer authorization, routes, API base URL and redirect policy are unchanged.
- Same-origin cookies are allowed; cross-origin credentials were not enabled.

Regression contract added in:

`backend/api/src/vendor-documents/ui-contracts.test.ts`

No shared API client was created or modified. No endpoint was made public, and
no ReplShield/security/CORS setting was disabled or widened.

## 5. Database, storage and business scope

No database/storage repair is needed for this issue. Prior diagnostic read-only
checks confirmed the existing document table's expected 11 columns, store
foreign key, RLS and denial of anonymous/authenticated direct table access.
Metadata loading does not access file storage.

No schema, migration, document storage, RLS, Vendor/product records, prices,
stock, Master Catalog, orders, customers, cart, checkout or Delivery Partner
business logic/data was changed. Integration-test fixtures use disposable
PostgreSQL, not the live marketplace.

Documentation and project memory record this diagnosis and credential policy;
they do not contain cookies, tokens or document contents.

## 6. Focused verification

Final command:

```sh
pnpm --filter @workspace/api exec tsx --test \
  --test-name-pattern='new vendors require documents|optional uploads do not unlock|private view denies|Documents ' \
  src/vendor-documents/vendor-documents.integration.test.ts \
  src/vendor-documents/ui-contracts.test.ts
```

**5 passed, 0 failed.** Coverage includes:

- Existing Vendor exemption and empty/new Vendor document status.
- Optional uploads, partial mandatory completion and complete mandatory status.
- Anonymous/Customer/cross-Vendor document denial and own authorized access.
- Private binary viewing/replacement contracts.
- Shared GET client, no omitted credentials, and same-origin upload/view policy.

Additional checks:

- Ordinary dashboard Vite build passed. A second build with explicit Supabase
  public environment inputs reached module transformation but exceeded its
  100-second limit; no compile error was reported. That second build is not
  counted as passed.
- Dashboard managed workflow restarted successfully and is running.
- A direct request for the running Vite Documents module confirmed the shared
  GET client, exactly two same-origin binary/file requests, and no omitted
  credentials.
- Passive screenshot verification was attempted, but screenshot upload failed
  with an expired capture-service token. This is not an application/Supabase
  session result and is not counted as a successful screenshot.

No automated browser tests or deployment were performed. The affected browser's
post-fix authenticated request has not been observed; the source correction,
served module and focused tests are verified, not a completed browser challenge.

Diagnosis and targeted fix complete. No further feature work was started.
