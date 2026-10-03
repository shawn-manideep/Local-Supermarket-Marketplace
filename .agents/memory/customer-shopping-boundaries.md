---
name: Customer shopping boundaries
description: User requirements that must remain consistent during customer shopping changes.
---

Keep contextual cart navigation rather than a permanent Cart bottom-navigation tab. Adding an item must not force customers into their cart, and returning from the cart must let them continue shopping.

**Why:** The customer shopping brief explicitly requires contextual cart behavior and says not to restore a permanent Cart tab.

For multiple active selling options, require an explicit customer selection, even when only one of those options is currently purchasable. Only a genuinely single-option listing may select its option automatically.

**Why:** The user requires choosing a variant before adding a multi-variant product, rather than assuming their preferred pack size.

Availability refreshes must not substitute a different option for the customer's selection, even when only one option remains afterward.

**Why:** The user requires adding the intended variant and preventing stale selection from creating an incorrect cart item.

**How to apply:** Retain a valid choice; clear an invalid choice and require reselection. Single-option automatic selection is an opening-screen convenience, not a refresh fallback.

Global grocery search must work without choosing a category. Category browsing is an optional filter across eligible store listings, not permission to merge vendors' prices or inventory.

**Why:** The user distinguishes global discovery from store-specific purchasing and requires saved-address pincode eligibility.

**How to apply:** Keep pack size separate from order quantity; preserve public response allowlists and existing server purchase checks. Customer shopping work must not redesign vendor catalog, authentication, reorder, order lifecycle, or inventory behavior.

Use focused API/customer tests and build checks for this phase; do not run automated browser acceptance or claim manual acceptance is complete.

**Why:** The user explicitly reserves browser acceptance for their own manual verification.

Customer Global Search has been manually verified. Leave it unchanged when working on Product Details and variant selection.

**Why:** The user confirmed that category-optional global search works and explicitly said not to redesign it in the focused continuation.

**How to apply:** Improve listing-specific details, selection, and cart submission without changing the approved search interface or discovery behavior.

The user has now manually verified Product Details, multi-variant selection, quantity, selected-variant Cart identity, server-owned pricing/totals, stock/privacy, and one-store contextual cart navigation. Leave that shopping flow unchanged during Reorder / Buy Again work.

**Why:** The reorder brief explicitly confirms this flow and limits the phase to customer reorder.

**How to apply:** Add reorder to existing order history without a Home, search, details, or cart redesign. Do not run automated browser acceptance, claim new manual acceptance, or deploy to production.