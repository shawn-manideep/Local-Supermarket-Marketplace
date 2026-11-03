---
name: Mobile login transition
description: Approved phased mobile/password authentication scope and ownership prerequisites.
---
Customer, Vendor and Delivery Partner sign-in must now use a single
username-or-email field plus password, with no mobile/OTP sign-in options.
Mobile registration and verified-mobile recovery remain available where
already supported; this is not permission to remove their ownership checks.

Do not enable Phone Auth, implement OTP, integrate paid phone providers,
replace identities or invent Delivery Partner passwords.

**Why:** The user replaced the earlier phased mobile-sign-in direction with
consistent username/email/password sign-in across all three portals, while
requiring mobile registration and recovery to be preserved.

When secure phone enrollment or provider setup is out of scope, the user permits
only the safe portion of mobile registration. Keep email-free account creation
explicitly unavailable rather than inventing emails, auto-confirming numbers,
or treating form validation as ownership verification.

**Why:** The user's registration request explicitly requires reporting this
limitation and forbids provider setup or bypassing Supabase Auth.

**Why:** The user explicitly approved the phased option after learning that no
existing account had a verified Auth phone and that removing legacy access would
lock users out. That approval did not authorize OTP providers or enrollment.

**How to apply:** Never promote editable contact/address/order numbers into login
identities or invent verified phones. Retain existing account ownership and Admin
email/password behavior. Mobile enrollment and removal of email-dependent signup
need separately authorized ownership verification; do not silently treat this
transition as approval to enable phone providers or change production settings.
