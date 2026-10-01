---
name: Catalog browser evidence
description: Avoid false passes and false failures in authenticated catalog acceptance checks.
---

**Rule:** After a UI action, wait for the affected entity's new state and confirm it with an authoritative read-back. After navigation, ensure the new page has loaded before checking controls. For semantic labels transformed by CSS, compare source text rather than requiring `innerText` to retain the authored case.

**Why:** A success message from an earlier archive action was still visible while the next archive was in flight; checking that message made a database read appear to contradict the UI. A reload likewise exposed controls from the old document immediately before its context was destroyed. CSS uppercasing also made valid user-facing labels fail exact-case browser checks.

**How to apply:** Use normal authenticated role sessions for catalog proof; tie each assertion to a specific product or variant after its current request settles. Keep previously passing browser evidence labeled as historical when resuming an interrupted run, rather than silently counting it as a fresh pass.

**Manual verification constraint:** Do not run additional automated browser tests for this catalog acceptance work unless the user explicitly authorizes them. The user performs the remaining UI checks; the agent can confirm their outcomes through read-only database inspection. Archive only records positively attributed to testing, never real or unattributed development records.

**Why:** On 2026-10-01, after repeated browser-harness failures, the user explicitly chose targeted manual verification and safe test-data cleanup instead of another automated browser run.

**Cleanup versus UI evidence:** Existing authenticated Admin API operations may be used for expressly authorized, positively identified test-data cleanup without browser automation. Report the operation and its read-only confirmation separately; it does not prove the Admin UI works.

**Exact timestamp provenance:** Read PostgreSQL timestamps as text when preserving them for an exact ownership guard.

**Why:** PostgreSQL retained microseconds that the Node PostgreSQL driver's JavaScript `Date` representation dropped. Comparing the serialized millisecond timestamp to the original database value rejected otherwise valid test-record provenance. Keep the original precision rather than weakening the safety guard.