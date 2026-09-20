---
name: Legacy workflow preview routing
description: Environment-specific limitation when legacy webview workflows coexist with registered artifact services.
---

Legacy webview workflows can open their configured local ports successfully without receiving a usable public development URL when the workspace also has artifact-managed preview routing. Stopping the managed artifact workflows may not release or remap those public domains. In this workspace, validated `.replit` updates also remove manually added legacy `[[ports]]` mappings.

**Why:** Dashboard, customer, and backend listeners all accepted container-network requests and Replit Host headers, but the normal development domain returned a router 404 and explicit external ports returned Replit-generated 502 pages even after managed artifact workflows were stopped.

**How to apply:** Before promising a manual URL for an app outside `artifacts/`, verify the public development domain directly and confirm port mappings survive validation. If routing is absent, use an approved artifact migration/registration stage rather than guessing a port-specific hostname.