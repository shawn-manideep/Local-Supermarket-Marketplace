---
name: Customer browser verification origin
description: Why interactive Customer browser checks must use the public development origin rather than the localhost proxy.
---

For authenticated Customer browser checks, use the workspace development domain, not the localhost screenshot proxy origin. A localhost browser can render the static Expo Web app but API mutations can fail the configured CORS origin check.

**Why:** A cart action failed from the localhost proxy while the same action succeeded on the public development origin; changing backend CORS would have violated the Customer-only UI scope and widened access unnecessarily.

**How to apply:** Use the artifact screenshot proxy for static visual checks. For browser-driven Customer API interactions, use the existing development domain and keep credentials out of logs. Do not adjust API CORS just to accommodate a localhost-only test harness.

For automated DEV checks of the static Expo Web preview, a verified sign-in URL fragment did not establish the Customer session. The existing web storage adapter did restore a session when it was persisted on the same development origin before reload. Never print or save the session in reports or project files.

**Why:** The isolated browser tester could not use the workspace's dedicated test-password secrets, and URL-fragment navigation left the preview on the sign-in screen despite successful DEV authentication.

**How to apply:** When a dedicated DEV test account needs browser verification, prefer normal sign-in with working credentials. If those credentials are unavailable, use only an authorized DEV test-account session held in memory by the test harness, populate the app's existing same-origin web storage, and clear the temporary browser profile afterward. Never use this workaround for production or real-user accounts.