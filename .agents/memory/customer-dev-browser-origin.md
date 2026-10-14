---
name: Customer browser verification origin
description: Why interactive Customer browser checks must use the public development origin rather than the localhost proxy.
---

For authenticated Customer browser checks, use the workspace development domain, not the localhost screenshot proxy origin. A localhost browser can render the static Expo Web app but API mutations can fail the configured CORS origin check.

**Why:** A cart action failed from the localhost proxy while the same action succeeded on the public development origin; changing backend CORS would have violated the Customer-only UI scope and widened access unnecessarily.

**How to apply:** Use the artifact screenshot proxy for static visual checks. For browser-driven Customer API interactions, use the existing development domain and keep credentials out of logs. Do not adjust API CORS just to accommodate a localhost-only test harness.

The tool notebook and browser tester do not automatically have the application's
runtime secrets. Prefer a workspace-side browser harness that consumes existing
test credentials internally and performs normal UI sign-in.

**Why:** Credential availability in the running workspace did not make those
credentials readable inside the isolated tool notebook. Trying to bridge that
gap through tool output or authentication changes is unnecessary.

**How to apply:** Keep credentials and sessions inside the runtime process and
isolated browser context. Emit only sanitized assertions/screenshots, bound
browser startup and cleanup, and remove temporary profiles on failure as well
as success. Never copy credentials into code, reports, or tool arguments.

The embedded workspace preview may send this application's legacy `.repl.co`
Origin even when the runtime development hostname ends in `.replit.dev`.
Approve only explicitly verified application origins; never infer the browser
Origin from the API URL, Referer, or workspace parent page.

**Why:** Mac Chrome login evidence identified a project-specific `.repl.co`
origin that the development-only `.replit.dev` allowlist rejected before
credentials were checked.

**How to apply:** Obtain the failed request's actual Origin and use its
canonical scheme/host/port (without a path or trailing slash). Keep compatibility
aliases explicit and development-only; do not allow arbitrary Replit subdomains.
