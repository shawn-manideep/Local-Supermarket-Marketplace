---
name: Customer-only localization boundaries
description: Customer-only English/Telugu scope and preference/data boundaries; other portals are excluded.
---
English/Telugu localization is exclusively for the Customer Portal. Vendor,
Delivery Partner, Admin, shared dashboard UI and their authentication screens
are out of scope. This supersedes the earlier all-portals localization scope.

**Why:** The user explicitly narrowed the scope to Customer only and requested
removal of prior language-feature additions to the other portals.

**How to apply:** Reuse the Customer foundation without adding dashboard
providers, selectors, font/style changes or language dependencies. Later
Customer phases must inventory labels, errors, empty/loading states,
accessibility text and receipt presentation, not just navigation. Do not call
the Customer interface fully bilingual after translating only the selector.

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
