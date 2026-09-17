# Phase 2 API Foundation

The Phase 1 `GET /health` endpoint remains the only registered application
endpoint. No customer, vendor, admin, store, product, category, cart, or order
API has been added.

Reusable backend authentication middleware is available for later endpoints:

- `requireAuth()` verifies a Supabase Auth bearer token and attaches
  `{ userId, role, storeId }` to the request.
- `requireRole(...roles)` additionally enforces an application role.

The middleware resolves vendor store authorization from the authenticated user
and database relationship. It does not accept a client-supplied store ID as an
authorization source.