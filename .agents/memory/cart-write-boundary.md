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