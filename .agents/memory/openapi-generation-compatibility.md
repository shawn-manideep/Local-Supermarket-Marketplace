---
name: OpenAPI generation compatibility
description: Orval export and DOM typing quirks when adding path-plus-query mutation APIs.
---

Do not assume successful Orval generation means the generated libraries typecheck. Operations with both path and query parameters can produce a path-validator value and a query-input type with the same exported Params name.

**Why:** The installed Orval version produced an ambiguous barrel export when reorder introduced both parameter kinds. Generated mutation header helpers also require DOM iterable typings.

**How to apply:** Keep path validators and query-input types explicitly disambiguated at the barrel boundary, and preserve DOM iterable support for generated fetch clients. Regenerate and check the library build before treating a new API contract as ready.