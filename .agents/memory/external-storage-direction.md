---
name: External storage direction
description: Owner-approved preparation scope for a future separate API and private external GCS.
---

Preferred target: owner-controlled private GCS for a future separate API deployment.
Preserve the original Supabase database and existing database references wherever
compatibility is verified. Preserve all four portals and their authorization.
The existing Replit-managed storage remains the active source.

**Why:** The user selected this direction after the project-exclusive storage
boundary ruled out a supported no-copy bridge under the no-mixed-publishing rule.

**How to apply:** Code preparation and synthetic local fixtures do not authorize
live migration, cutover, bucket/IAM provisioning, runtime activation, deployment,
or APK building. Seek separate approval for those stages; do not interpret a
configuration marker or synthetic compatibility test as evidence of live readiness.
