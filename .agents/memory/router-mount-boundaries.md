---
name: Express router mount boundaries
description: A middleware mount regex can silently miss nested mutation routes.
---
Prefer literal path-prefix mounts for shared authorization guards covering
parent and child routes. Test nested mutation methods explicitly, not just
the collection endpoint.

**Why:** A regex mount that consumed the separator after a collection path
failed Express's mount-boundary matching for child resource URLs. Collection
writes were gated while nested writes skipped the guard.

**How to apply:** When changing reusable route authorization, assert the intended
denial code on parent, child and batch mutation paths before relying on it.
An ownership-related 404 alone is not evidence that the separate business gate ran.
