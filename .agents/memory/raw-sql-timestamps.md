---
name: Raw SQL timestamp mapping
description: Runtime timestamp representation differs between raw Drizzle SQL and mapped schema selections.
---

Raw Drizzle SQL timestamps may arrive as strings even when the generic result
type declares Date. Schema-column selections can still return actual Dates.
Normalize raw timestamp values before Date-only comparisons or serialization.

**Why:** A raw aggregate timestamp reached catalog history as text and caused an
HTTP 500 after its missing-table dependency was repaired. Compile-time result
types did not reveal the runtime mismatch.

**How to apply:** Inspect actual raw result shapes rather than assuming a typed
generic applies runtime conversion. Cover string, Date and null inputs when
testing response serialization; never silently discard a valid timestamp.
