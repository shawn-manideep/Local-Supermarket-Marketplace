---
name: Legacy workflow preview routing
description: Environment-specific limitation when legacy webview workflows coexist with registered artifact services.
---

Legacy webview workflows can open their configured local ports successfully without receiving a usable public development URL when the workspace also has artifact-managed preview routing. Stopping the managed artifact workflows may not release or remap those public domains. In this workspace, validated `.replit` updates also remove manually added legacy `[[ports]]` mappings.

**Why:** Dashboard, customer, and backend listeners all accepted container-network requests and Replit Host headers, but the normal development domain returned a router 404 and explicit external ports returned Replit-generated 502 pages even after managed artifact workflows were stopped.

**How to apply:** Before promising a manual URL for an app outside `artifacts/`, verify the public development domain directly and confirm port mappings survive validation. If routing is absent, use an approved artifact migration/registration stage rather than guessing a port-specific hostname.

Artifact manifests may validate a `[services.env]` `PORT` value, but managed Run still injects and uses the platform-allocated service port. Changing `localPort` to a desired fixed port does not change that injected runtime value and instead breaks proxy routing.

**Why:** A validated fixed `PORT` configuration left each managed service listening on its previously allocated port while the router expected the edited `localPort`.

**How to apply:** Treat managed artifact ports as platform-owned. Do not promise or force fixed development ports unless Replit adds a documented artifact runtime setting that controls the allocated port itself.