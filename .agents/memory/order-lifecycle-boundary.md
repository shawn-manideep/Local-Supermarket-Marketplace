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
Deduct variant stock exactly once at successful order placement, inside the
same transaction as snapshots, initial history, and cart conversion. Carts
never reserve stock. Later fulfillment transitions do not deduct again.
Restore only on the existing permitted PLACED→CANCELLED or PLACED→REJECTED
transition, at most once, in the status/history transaction. Historical
orders with no original deduction must never receive fictitious restoration.
Vendor operational reads must remain scoped to the authenticated vendor's
single store and must never expose commission or customer ownership internals,
including action responses. Admin order operations remain read-only unless a
future approved phase explicitly grants lifecycle actions.
Delivery execution is now assigned-partner-owned under the approved Phase 7
scope. Use the same order lifecycle READY→OUT_FOR_DELIVERY→DELIVERED and
immutable fulfillment snapshots. The separate assignment duty state must never
become a competing customer order lifecycle.

**Why:** Phase 7 explicitly transfers dispatch/completion from the vendor to
the assigned active partner, while prohibiting inventory effects and historical
order rewrites.

**How to apply:** Vendor preparation still stops at READY. Do not restore vendor
dispatch/completion permissions as a shortcut for legacy orders without an
assignment; legacy fulfillment remediation needs explicit approval.

Vendor order preparation stops at READY. The preparation screen must not offer
dispatch or delivery actions; the assigned partner performs delivery execution.

**Why:** The user explicitly scoped Vendor Order Management to
PLACED→ACCEPTED→PREPARING→READY, with PLACED→REJECTED as the rejection path,
while requiring the existing full lifecycle and history to remain intact.

**How to apply:** Treat READY as "Ready for fulfillment", not as automatic
dispatch or delivery-partner assignment. Do not remove the existing delivery
lifecycle when refining vendor preparation.

Stock stays on each vendor's selling variant, never on the Master Catalog.
Use a minimal inventory-effect marker and customer-scoped checkout identity,
not a ledger or reservation subsystem. Keep operational inventory markers
out of customer read contracts.

**Why:** The user explicitly required atomic placement deduction, exactly-once
effects, no historical snapshot rewrites, and the smallest compatible
architecture for Stock Management & Orderable Quantity.

**How to apply:** Preserve immutable receipt snapshots, current-price cart
behavior, the existing lifecycle, and vendor store isolation when changing
inventory. Do not extend restoration to new statuses without approval.