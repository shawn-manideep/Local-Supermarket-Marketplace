---
name: OpenAPI generation compatibility
description: Orval export and DOM typing quirks when adding path-plus-query mutation APIs.
---

Do not assume successful Orval generation means the generated libraries typecheck. Path/query parameters and inline JSON request bodies can produce validator values and input types with the same capitalized export name.

**Why:** The installed Orval version produced ambiguous barrel exports for both mixed path/query parameters and inline request bodies. Generated mutation header helpers also require DOM iterable typings.

**How to apply:** Keep path validators and query-input types explicitly disambiguated at the barrel boundary, and preserve DOM iterable support for generated fetch clients. Regenerate and check the library build before treating a new API contract as ready.

Prefer explicit OpenAPI schema properties over YAML merge keys unless their handling has been verified with the installed generator.

**Why:** Reusing store-profile properties with YAML anchors and `<<` merge keys caused both generators to fail with `block.split is not a function`; explicit properties generated successfully. Closed base schemas also cannot be extended through `allOf` without rejecting the added fields.

**How to apply:** Keep strict creation/edit input contracts explicit, or normalize merge keys before generation. Do not interpret this generator error as a TypeScript or application failure.