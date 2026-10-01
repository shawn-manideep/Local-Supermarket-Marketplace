---
name: Catalog stock write concurrency
description: Why catalog batches need their own row locks and stale-data checks without changing checkout.
---

The Master Catalog advisory lock does not serialize catalog stock writes with
order inventory writes. Bulk catalog edits must lock the affected variant rows
and reject stale saved-variant revisions before writing.

**Why:** A complete multi-variant form includes stock alongside prices. Saving
an old form must not restore stock that an order already deducted. Adding a
global catalog lock to checkout would expand an explicitly out-of-scope flow.

**How to apply:** Keep concurrency protection at the catalog writer boundary,
retain the existing checkout/order behavior, and reject the whole batch on a
stale variant or ownership mismatch. Do not silently replace dirty editor
drafts when fresh saved data arrives.