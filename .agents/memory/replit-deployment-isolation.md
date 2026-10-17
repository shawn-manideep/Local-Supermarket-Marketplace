---
name: Replit deployment isolation
description: Independent publishing and App Storage boundaries between Replit projects.
---

Replit publishes all artifacts in a project together. Each Replit project owns an exclusive App Storage bucket; do not assume a raw Google Cloud external-account credential sidecar or bucket paths can be reused across projects. Use the supported `@replit/object-storage` SDK for a separate project.

**Why:** Replit documentation specifies whole-project publishing, project-exclusive App Storage, and SDK-managed credentials.

**How to apply:** For an API-only deployment, use a separate project containing only the API service and its workspace dependencies. Provision that project's own storage bucket and adapt storage access to the supported SDK; do not publish a mixed portal project or copy its storage settings.
