---
name: External storage direction
description: Current portable-storage direction and approval boundaries.
---

The user selected Cloudflare R2 as an additional portable storage provider.
Preserve existing Replit files, existing providers/defaults, database references
and all four portals' authorization. Do not infer approval to activate or migrate
from approval to implement code and synthetic tests.

**Why:** The user explicitly requested R2 preparation while prohibiting live
activation, credential installation, cloud-resource creation and database migrations.
This supersedes the earlier external-GCS preference, not the preservation rules.

**How to apply:** Seek separate approval for live inventory, asset copying,
credentials, cloud resources, runtime activation, deployment and APK building.
Stop if safety requires an unapproved schema migration. A configuration marker
or synthetic compatibility test is not evidence of live readiness.
