---
name: Development preview credentials
description: Preview protection cookies must accompany same-origin API calls, independently of Supabase bearer authentication.
---
Keep the normal same-origin credential policy for development-preview API
requests, including raw document uploads and authenticated binary reads. Reuse
the existing API client for JSON requests.

**Why:** User-provided browser Network evidence showed a Documents request
redirecting with HTTP 307 to Replit's ReplShield while the backend returned 200.
Documents explicitly omitted cookies; working Vendor requests used the default
same-origin policy. The Supabase bearer header does not replace preview cookies.

**How to apply:** Compare URL, bearer headers and fetch credential mode when a
single preview API redirects to ReplShield. Do not make endpoints public,
disable protection, widen cross-origin credentials or change business/database
logic to work around this transport issue. HTTP checks outside the affected
browser session do not verify its preview-cookie challenge.
