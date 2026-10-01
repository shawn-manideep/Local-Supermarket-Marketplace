---
name: Catalog browser evidence
description: Avoid false passes and false failures in authenticated catalog acceptance checks.
---

**Rule:** After a UI action, wait for the affected entity's new state and confirm it with an authoritative read-back. After navigation, ensure the new page has loaded before checking controls. For semantic labels transformed by CSS, compare source text rather than requiring `innerText` to retain the authored case.

**Why:** A success message from an earlier archive action was still visible while the next archive was in flight; checking that message made a database read appear to contradict the UI. A reload likewise exposed controls from the old document immediately before its context was destroyed. CSS uppercasing also made valid user-facing labels fail exact-case browser checks.

**How to apply:** Use normal authenticated role sessions for catalog proof; tie each assertion to a specific product or variant after its current request settles. Keep previously passing browser evidence labeled as historical when resuming an interrupted run, rather than silently counting it as a fresh pass.