---
name: Admin management boundaries
description: Approved platform-management scope and preservation requirements.
---

The Admin Portal is an account/store management layer, not an operational portal. Admin manages vendor approval/suspension, customer access, and partner provisioning/access. No role conversion, impersonation, order/stock/product editing, delivery execution, payments, or password viewing.

**Why:** The user explicitly approved this scope while preserving the accepted customer/vendor/partner workflows and prohibiting feature creep.

**How to apply:** Reuse the original store transitions, global username registry and partner provisioning service. Account deactivation must preserve historical records and existing delivery assignments, with an explicit warning for outstanding duties. Reactivation uses the original identity.

Customer access status must not become a second authentication system or a global status replacing store and partner lifecycles.

**Why:** Existing email/password sessions and separately accepted store/partner status models must remain compatible; customer deactivation needs a protected-access boundary, not an identity replacement.

**How to apply:** Deny inactive access at the protected API and applicable direct-read boundaries without rewriting commerce, identity or history. A Supabase session remaining valid does not imply permission to use protected customer functionality.