---
name: Customer reorder boundaries
description: Product semantics and safety constraints for Reorder and Buy Again.
---

Reorder means adding eligible exact historical store/product/variant identities and previous order quantities to a reviewable current cart, never placing or charging for an order immediately. Do not substitute products, brands, pack sizes, or variants.

**Why:** The user explicitly distinguishes reorder from immediate order placement and requires exact historical identity.

**How to apply:** Recheck current store eligibility, listing and variant activity/availability, positive current prices, stock, and merged cart quantity limits. Keep historical snapshots immutable. Same-store items merge; different-store replacement needs explicit confirmation. Zero eligible additions must leave the existing cart untouched.

Individual-item and whole-order retry intents must be distinguishable without altering historical order data. A failed or uncertain response must not cause the same submitted intent to increase quantity twice.

**Why:** Buy Again introduces a narrower intent than whole-order Reorder, while both use the same original order and existing retry infrastructure.

**How to apply:** Bind retries to the source order, optional historical item, selected address, and store-switch confirmation. Keep scope metadata internal; customer receipts need only their added/unavailable item summaries.