---
name: Order lifecycle boundary
description: Durable transaction, snapshot, and inventory rules for order creation and status changes.
---

Order creation and lifecycle mutation must remain API-only. Order creation
takes the same per-customer advisory transaction lock as cart writes before
reading the active cart, then locks and revalidates all authoritative values
before atomically writing snapshots, initial history, and cart conversion.

**Why:** Ownership-only RLS cannot enforce cart conversion, financial
snapshots, legal transitions, or matching append-only history. READ COMMITTED
is intentional because statements after a waited advisory lock must see the
winner's committed cart state rather than an earlier transaction snapshot.

**How to apply:** Keep customer/vendor/admin direct order mutations revoked.
Use row locks for status changes and append history in the same transaction.
Do not deduct or reserve stock until a future inventory rule explicitly
defines that behavior; always revalidate the current enforceable stock limit.
Vendor operational reads must remain scoped to the authenticated vendor's
single store and must never expose commission or customer ownership internals,
including action responses. Admin order operations remain read-only unless a
future approved phase explicitly grants lifecycle actions.
MVP delivery remains vendor-owned: use the same order lifecycle for
READY→OUT_FOR_DELIVERY→DELIVERED, show immutable delivery snapshots, and do
not add delivery agents, assignment, tracking, location, or a second delivery
status model.

Vendor order preparation stops at READY. The preparation screen must not offer
dispatch or delivery actions; preserve those in the separate existing
vendor-owned delivery workflow.

**Why:** The user explicitly scoped Vendor Order Management to
PLACED→ACCEPTED→PREPARING→READY, with PLACED→REJECTED as the rejection path,
while requiring the existing full lifecycle and history to remain intact.

**How to apply:** Treat READY as "Ready for fulfillment", not as automatic
dispatch or delivery-partner assignment. Do not remove the existing delivery
lifecycle when refining vendor preparation.