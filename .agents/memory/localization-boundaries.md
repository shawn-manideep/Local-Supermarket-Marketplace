---
name: Localization boundaries
description: Customer localization, limited Vendor/Delivery sign-in exception, and preference/data boundaries.
---
English/Telugu localization covers the Customer Portal. The later approved
username/email sign-in task adds a narrow exception for Vendor and Delivery
Partner sign-in screens, including password visibility labels. Admin and the
Vendor/Delivery operational screens remain outside that exception.

**Why:** The user initially narrowed localization to Customer only, then explicitly
requested English/Telugu for all three username/email sign-in screens.

**How to apply:** Keep the dashboard exception limited to sign-in; do not introduce
global dashboard providers, font/style changes or translate operational screens. Later
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

Known interface/service feedback may be translated only through an explicit
allowlist or fixed template that preserves inserted customer/catalog content.
Keep active feedback canonical and translate at display time. Locale-specific
display dates must never become scheduling keys or alter accepted windows.

**Why:** The Customer translation requirements forbid automatic translation of
entered/catalog data and require live switching without resetting active
forms, checkout state or delivery rules.

**How to apply:** Review error/notice translations and date presentation
separately from business values. Preserve opaque messages outside the known
catalog rather than attempting general text replacement.
