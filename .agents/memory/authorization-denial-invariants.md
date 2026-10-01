---
name: Authorization denial invariants
description: Negative authorization tests must verify aggregate state, not just HTTP status.
---

For any rejected cross-store mutation, assert that both the parent record and its
children remain unchanged. A 401/403/404 response alone is not evidence that the
operation was side-effect free.

**Why:** Authenticated acceptance testing found that a correctly rejected response
could still follow a committed child mutation. Status-only tests and successful
typechecks did not catch it; a later positive shopping check exposed the changed
eligibility.

**How to apply:** Resolve ownership before child writes. If an ownership-filtered
mutation affects no parent row, throw inside the transaction, not after it
commits. Include before/after state assertions in negative API tests, especially
for inventory, availability, and other aggregate updates.