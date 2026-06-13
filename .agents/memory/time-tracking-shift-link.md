---
name: time-tracking shift linkage guards
description: Order and authz rules when a time entry links a planned shift (shiftId)
---

# Linking a shift to a time entry (POST /api/time-tracking)

When a request links a planned shift via `shiftId`, validate in this order
**before** inserting:

1. Load the shift; 404 if it does not exist.
2. Ownership: reject (403) unless `shift.userId === effectiveUserId` (the user
   the entry is being created for; for assistants that is the session user).
3. Duplicate guard: reject (409, code `shift_already_booked`) if a time entry
   already references that `shiftId`.

**Why:** the dedupe guard is global per `shiftId`. Without the ownership check
first, any user could attach *another* user's `shiftId` to their own entry and
permanently block the rightful owner from booking it (their later request hits
the 409). Ownership must gate the dedupe.

**How to apply:** any new write path that accepts a `shiftId` (web adopt flow,
mobile, future bulk import) must reuse these guards. Consider a DB partial
unique index on `time_tracking.shift_id WHERE shift_id IS NOT NULL` to make the
dedupe race-safe if concurrency ever matters.
