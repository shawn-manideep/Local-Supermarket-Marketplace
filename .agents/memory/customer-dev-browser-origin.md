---
name: Customer browser verification origin
description: Why interactive Customer browser checks must use the public development origin rather than the localhost proxy.
---

For authenticated Customer browser checks, use the workspace development domain, not the localhost screenshot proxy origin. A localhost browser can render the static Expo Web app but API mutations can fail the configured CORS origin check.

**Why:** A cart action failed from the localhost proxy while the same action succeeded on the public development origin; changing backend CORS would have violated the Customer-only UI scope and widened access unnecessarily.

**How to apply:** Use the artifact screenshot proxy for static visual checks. For browser-driven Customer API interactions, use the existing development domain and keep credentials out of logs. Do not adjust API CORS just to accommodate a localhost-only test harness.