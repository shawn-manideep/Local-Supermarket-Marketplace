---
name: Partner identity boundaries
description: Approved identity scope and non-obvious username requirement interpretation.
---

Delivery Partner identity work must preserve the manually accepted Phase 5 stock behavior and existing customer/vendor/admin email login, Supabase sessions, logout, and role-resolution architecture.

**Why:** The user explicitly declared Phase 5 manually accepted and prohibited authentication redesign during the partner extension.

**How to apply:** Keep changes additive. Do not invent usernames for existing accounts or introduce partner assignments/execution under a portal-only request. Assignment, pickup, delivery transitions, notifications, GPS and maps need separate explicit approval.

Use the explicit ASCII 3–30-character username rule, including accepting the four-character example `shar`; never trim or sanitize an invalid username.

**Why:** The approved prerequisite contradicts itself by listing `shar` as invalid while specifying a minimum of three characters. The implementation decision, announced before proceeding, follows the explicit numeric rule rather than the contradictory example.

**How to apply:** Preserve identical client/server rules and lowercase-only normalization of otherwise valid input; do not silently introduce a five-character minimum.