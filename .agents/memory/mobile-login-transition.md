---
name: Mobile login transition
description: Approved phased mobile/password authentication scope and ownership prerequisites.
---
Mobile/password sign-in is a phased transition for Customer, Vendor and Delivery
Partner accounts. Preserve separate legacy sign-in, including existing Vendors'
email-based access, until those accounts have securely verified mobile identities.
Email-dependent Customer/Vendor registration and recovery remain available.

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
