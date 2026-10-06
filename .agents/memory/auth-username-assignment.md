---
name: Auth username assignment
description: Customer migration choice and the shared-identity provisioning constraint.
---

Existing Customer usernames use normalized email prefixes with collision suffixes, preserving their Supabase IDs and passwords.

**Why:** The user chose email-prefix assignment rather than supplying a manual mapping when moving Customer login to Username + Password.

**How to apply:** Preserve assigned usernames in later changes; do not recreate identities or reset passwords to support login changes.

Automatic username reservation on Auth creation must distinguish explicit Customer registration from Admin-provisioned Vendor/Delivery Partner creation.

**Why:** Admin provisioning initially creates an Auth identity with a temporary Customer shell before assigning its actual role. Automatically reserving a Customer username for every new Auth identity would conflict with immutable shared username bindings.

**How to apply:** Keep explicit Customer registration metadata separate from privileged provisioning. Use the existing shared username registry for every role.

Non-deliverable placeholder Auth emails are provider identities, not usable recovery contacts.

**Why:** Recovery must use a real registered contact without inventing contact details or changing existing identities.

**How to apply:** Keep recovery confirmations generic. Obtain explicit approved contact updates before enabling email delivery for placeholder identities; do not introduce SMS or another recovery system without approval.
