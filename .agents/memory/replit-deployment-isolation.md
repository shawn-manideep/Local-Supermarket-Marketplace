---
name: Replit deployment isolation
description: Independent publishing and App Storage boundaries between Replit projects.
---

Replit publishes all artifacts in a project together. Each Replit project owns an exclusive App Storage bucket; do not assume a raw Google Cloud external-account credential sidecar or bucket paths can be reused across projects. Use the supported `@replit/object-storage` SDK for a separate project.

**Why:** Replit documentation specifies whole-project publishing, project-exclusive App Storage, and SDK-managed credentials.

**How to apply:** For an API-only deployment, use a separate project containing only the API service and its workspace dependencies. If choosing Replit App Storage, its own bucket and supported SDK are required; neither provides the original project's files. Do not publish the mixed portal project or copy its storage bindings. The owner now prefers external private GCS; follow the separately approved [storage direction](external-storage-direction.md), not automatic provisioning of a new Replit bucket.
