---
name: Saved Items and product image boundaries
description: Approved scope for customer favorites/settings and Vendor image sources.
---
Customer favorites belong to the exact store-specific listing, even when different stores share the same Master identity. Saving must never reserve inventory, populate a cart, or place an order. Unavailable favorites remain removable.

**Why:** The user explicitly required these business boundaries.

**How to apply:** Reuse existing shopping and variant-selection flows when opening a saved item; retain server-side ownership and current availability checks.

Customer Settings may edit only existing full-name/phone profile fields. Account identity and recovery-contact information must be displayed safely; password changes must verify the current password through the existing Supabase provider.

**Why:** The user requested functional Settings without changing the authentication architecture.

**How to apply:** Do not expand Settings into identity reassignment, additional profile data or a new credential store without approval.

Vendor product images have one active source: an HTTP(S) URL or an upload. Customer-visible product images must remain separate from private Vendor Documents and must never update Master Catalog images.

**Why:** The user approved product-image uploads while explicitly protecting Vendor Documents and Master Catalog ownership.

**How to apply:** Preserve store ownership and normal product visibility; never reuse private document paths, policies or access links for product photos.
