---
name: Legacy workflow preview routing
description: Environment-specific limitation when legacy webview workflows coexist with registered artifact services.
---

Legacy webview workflows can open their configured local ports successfully without receiving a usable public development URL when the workspace also has artifact-managed preview routing. Stopping the managed artifact workflows may not release or remap those public domains.

**Why:** In this workspace, dashboard and customer webview workflows listened successfully on their local ports, but the normal development domain continued returning a routing 404 and the Expo development domain returned “Backend Not Configured,” even after the managed artifact workflows were stopped.

**How to apply:** Before promising a manual URL for an app outside `artifacts/`, verify the public development domain directly. If it is not routed, use an approved artifact migration/registration stage rather than guessing a port-specific hostname.