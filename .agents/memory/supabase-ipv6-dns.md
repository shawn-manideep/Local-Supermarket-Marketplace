---
name: Supabase direct-endpoint DNS and IPv6
description: Why ordinary DNS checks can succeed while the workspace PostgreSQL driver reports ENOTFOUND.
---

An IPv6-only Supabase direct database endpoint can resolve through unfiltered
DNS queries but fail through Node's ordinary TCP connection lookup when the
workspace has no IPv6 interface addresses.

**Why:** Node 24 applies `dns.ADDRCONFIG` for ordinary TCP lookup on this platform.
Unfiltered lookup and AAAA resolution succeeded while the same lookup with
ADDRCONFIG consistently returned ENOTFOUND. This was address-family filtering,
not evidence of intermittent DNS or incorrect credentials.

**How to apply:** Compare lookup hints and interface address families before
retrying unchanged direct connections. Use only an owner-verified session-mode
pooler endpoint when a separately authorized connection needs IPv4; never guess
its hostname or weaken TLS. Read-only Supabase management-API inspection can
establish schema/count evidence independently, but cannot prove the PostgreSQL
driver's TLS, startup-option or session-pooler compatibility.
