---
name: Cart write boundary
description: Security and concurrency rules for customer cart mutations and checkout preparation.
---

Customer cart and cart-item mutations must remain API-only; authenticated
public Supabase clients may read owned carts but must not write them directly.

**Why:** Cart integrity depends on coordinated lifecycle, same-store product,
availability, stock, and server-derived financial checks that permissive
row-ownership RLS cannot enforce by itself.

**How to apply:** Serialize mutations for a customer in PostgreSQL, revalidate
current product/store/address values transactionally, and preserve the
validation-only boundary until order creation performs its own final checks.

## Customer UI intent across navigation

Leaving Cart is not cancellation of quantity changes the Customer has already
requested. Preserve queued intent until it is persisted, and do not let an older
response undo a newer pending removal. Returning views must read after pending
writes finish. An authentication change is a different boundary: never transfer
the old account's cart intent or state to the new account.

**Why:** The user requires rapid taps and navigation away/return to preserve
removal, counts and totals without resurrecting items or changing another
variant/store.

**How to apply:** Keep updates scoped to exact owned cart-line identity. Preserve
the distinction between draft purchase quantities (minimum one) and persisted
cart quantities (zero means removal), rather than changing all shared selectors
or backend stock rules.