---
name: Supabase query results
description: Avoid missing verification evidence when batching SQL through the Supabase MCP.
---

Use one result-producing SQL statement per verification call, or combine checks into one SELECT with subqueries.

**Why:** This project's Supabase MCP surfaced only the final result set when a count verification was followed by another SELECT. The earlier counts were absent from the returned evidence.

**How to apply:** Do not assume every SELECT in a multi-statement query appears in tool output. Check the actual returned fields; issue a separate read when a requested check is missing.