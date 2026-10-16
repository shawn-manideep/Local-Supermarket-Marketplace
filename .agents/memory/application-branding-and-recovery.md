---
name: Application branding and recovery boundaries
description: Platform logo scope, existing-storage reuse and the secure password-only recovery experience.
---
The application logo is platform-wide branding, not a replacement for Vendor
store identities, product images or private Vendor documents.

The current platform display name is Apna Local Basket, abbreviated ALB. Use
that name and abbreviation for app-owned visible branding across portals.

**Why:** The user explicitly renamed the marketplace and its brand initials.

**How to apply:** Update user-facing app labels, fallback marks and metadata;
leave store-owned names and internal identifiers unchanged.

**Why:** The user requested one application logo across all four portals while
expressly preserving the other upload features.

**How to apply:** Reuse the existing App Storage integration instead of adding
a Supabase bucket merely for branding. Keep platform branding independent of
store-owned logos and limit mutations to server-verified Admins. PNG/JPEG are
supported; SVG is excluded until a safe sanitization pipeline exists.

Forgot Password displays the two new-password fields without an identity input.
Signed-out recovery uses the identity already entered on sign-in, sends the
existing non-enumerating recovery instructions and requires password re-entry
after verified recovery. Passwords entered before verification are not sent or
persisted. A verified password update must match both account and portal role.

**Why:** The user requested password-only fields but explicitly allowed the
closest secure flow when ownership cannot otherwise be proven. Hiding the
identity field does not remove Supabase's need to verify ownership.

**How to apply:** Never make opening Forgot Password sufficient to update a
password. Retain recovery contact delivery and clear password fields on leaving
the flow; do not carry plaintext passwords through URLs, storage or emails.
