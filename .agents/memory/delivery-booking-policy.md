---
name: Delivery booking policy
description: Approved slot duration, India-time booking horizon and closed-store acceptance boundary.
---
Customers can select Instant or Scheduled delivery. Scheduled delivery uses
one-hour slots for today and tomorrow, derived from saved store operating hours
in India time. Expired or already-started full slots and periods outside
operating hours are not offered. Daily closure blocks Instant orders, but
Scheduled orders may be accepted for a valid future slot. Administrative
unavailability still blocks new orders. Allow cart additions/reorder when the
store is open or a valid future scheduled slot exists.

**Why:** The user selected “One-hour slots, today and tomorrow.” Their later
Customer portal requirements explicitly permit future Scheduled delivery during
daily closure, superseding the earlier blanket closed-store rejection rule.

**How to apply:** Keep delivery windows as historical order snapshots when
hours change. Retain the existing delivery lifecycle, with pickup/dispatch no
earlier than the scheduled start, rather than adding automatic dispatch or
silently rescheduling accepted orders.
