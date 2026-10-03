---
name: Customer shopping boundaries
description: User requirements that must remain consistent during customer shopping changes.
---

Keep contextual cart navigation rather than a permanent Cart bottom-navigation tab. Adding an item must not force customers into their cart, and returning from the cart must let them continue shopping.

**Why:** The customer shopping brief explicitly requires contextual cart behavior and says not to restore a permanent Cart tab.

For multiple active selling options, require an explicit customer selection, even when only one of those options is currently purchasable. Only a genuinely single-option listing may select its option automatically.

**Why:** The user requires choosing a variant before adding a multi-variant product, rather than assuming their preferred pack size.

Global grocery search must work without choosing a category. Category browsing is an optional filter across eligible store listings, not permission to merge vendors' prices or inventory.

**Why:** The user distinguishes global discovery from store-specific purchasing and requires saved-address pincode eligibility.

**How to apply:** Keep pack size separate from order quantity; preserve public response allowlists and existing server purchase checks. Customer shopping work must not redesign vendor catalog, authentication, reorder, order lifecycle, or inventory behavior.

Use focused API/customer tests and build checks for this phase; do not run automated browser acceptance or claim manual acceptance is complete.

**Why:** The user explicitly reserves browser acceptance for their own manual verification.