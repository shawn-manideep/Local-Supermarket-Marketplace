---
name: Variant UX boundaries
description: User-confirmed scope and no-conversion ordering rule for the final variant UX corrections.
---

The user confirmed that multiple selling variants and Add Another Variant already work. Treat further variant UX changes as focused corrections, not a reason to redesign or audit the catalog architecture.

**Why:** The user explicitly confirmed the existing functionality and requested implementation changes and a concise report only; they will perform browser verification manually.

For display ordering, compare numeric quantities within the same explicit unit only. Different units keep stable creation-order positions. Do not normalize g to kg or ml to L, even for sorting.

**Why:** The final corrections explicitly prohibit automatic unit conversion just for sorting. This replaces the earlier display-only cross-unit comparison interpretation.

**How to apply:** Keep all nine supported units, including bottle and box; never default a new variant to pack. Quantity and price formatting must be display-only and preserve legitimate decimals. Zero stock remains valid, while purchase eligibility still depends on existing server validation.

Do not modify any existing test data during a UX correction. Later cleanup requires explicit identification and authorization; past cleanup is not ongoing permission to alter test fixtures.

**Why:** The user asked to preserve both real development data and existing test data in this correction task.