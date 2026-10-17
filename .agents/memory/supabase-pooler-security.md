---
name: Supabase pooler security boundary
description: External TLS, upstream diagnostics and explicit session settings during isolated database preparation.
---

Do not interpret `pg_stat_ssl` as the external client's TLS verdict when
connecting through Supavisor. Treat the internal hop as a separate security
boundary requiring explicit owner acknowledgement if encryption is not observed.
Never claim that verified client-to-pooler TLS proves upstream encryption.

**Why:** A real isolated-project session authenticated with certificate and
hostname verification after trusting the owner-provided Supabase CA. Its backend
still reported `ssl=false`. Requested startup read-only/timeouts also did not
take effect: the backend retained its ordinary defaults.

**How to apply:** Verify the actual client TLS socket and peer hostname; retain
the backend TLS requirement on direct connections. Apply and read back explicit
session and transaction-local limits instead of trusting startup options.
Offline preparation/testing authorizes neither another remote connection nor
migrations. Preserve the separate owner approvals for each.
