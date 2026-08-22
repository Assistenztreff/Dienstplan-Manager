---
name: Default month-window filter on list endpoints
description: Where to scope a server-side "no month param → current month" default filter on shift/time-tracking style list endpoints, and what breaks if you get the scope wrong.
---

## Rule
When adding a server-side default time-range filter (e.g. "no month/year param → default to current calendar month") to a list endpoint like `GET /shifts` or `GET /time-tracking`, scope the default to requests **without** a resolved `effectiveUserId`/`userId` (team-wide, admin-context queries) — not to every request.

**Why:** User-scoped requests (a specific assistant's own shifts/time-tracking) are frequently intentionally cross-month — vacation lists, historical exports, single-record lookups by non-current date. Blanket-applying the default silently truncates those and breaks call sites and test helpers that assume full history, with no error to signal the truncation.

**How to apply:**
- Add an explicit `all=true` escape hatch that disables the default filter entirely; call sites that need full history (vacation/sick shift lists, exports) must pass it.
- A `month`+`year` pair still filters to that month; `year` alone is a legitimate new filter mode (year-window) — don't require month+year together.
- e2e helpers that deliberately book/query into a different month than "now" (e.g. a `dayTimes()`-style helper that books into next month to avoid weekend/holiday collisions) need `all=true` on any admin-context list-shifts assertions checking those bookings, or they'll only see current-month rows.
- Absence shifts (vacation/sick) are stored as one row per calendar day, not one row per range — relevant when reasoning about how a month-window filter interacts with multi-day absence periods spanning a month boundary.
