---
name: Localization product boundaries
description: Approved English/Telugu coverage goal and preference/data boundaries for future localization phases.
---
The product's language-support goal covers Customer, Vendor, Delivery Partner
and Admin interfaces, including authentication and shared controls. Do not call
the product bilingual after translating only Home or the language selector.

**Why:** The user explicitly requires complete English/Telugu coverage across
all four portals, delivered in reviewed phases.

**How to apply:** Later phases must inventory labels, errors, empty/loading
states, accessibility text and receipt presentation, not just navigation.

Keep language preferences separate from authentication storage. English is the
default; signed-out and individual account preferences are independent and
local to each app/device unless a later request approves broader persistence.
Changing language must not remount screens, clear carts or reset forms.

**Why:** The approved foundation requires persistence and account isolation
without changes to session handling, backend contracts or business rules.

**How to apply:** Keep localization presentation-only. Translate interface
labels around entered/catalog data, never automatically translate product/store
names, customer addresses or other user content. Retain enum identifiers,
request values and historical snapshots exactly.
