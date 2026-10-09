---
name: Legacy address compatibility
description: Preserve legacy address text and immutable historical order addresses during structured-address changes.
---
Legacy address lines may contain mixed house, street, building or landmark
information. Do not automatically split or backfill them into inferred
structured components. Retain all original text until the Customer explicitly
edits it. Nullable structured fields distinguish old records from new ones.
Other existing address consumers must continue receiving readable addresses.

Historical order addresses are snapshots, not references to the current saved
address. Editing a saved address must never rewrite an earlier order address.

**Why:** The user requires existing saved addresses and historical orders to
remain intact. Legacy free-text lines do not establish reliable component
boundaries, so guessing risks silent information loss.

**How to apply:** Use unparsed old text as the legacy display/edit fallback,
support legacy API input, and apply structured formatting only where structured
data exists. Snapshot new structured details when creating an order; never
rebuild historical addresses from the latest saved address.
