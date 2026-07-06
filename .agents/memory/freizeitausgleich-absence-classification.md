---
name: freizeitausgleich absence classification
description: A new absence-like shift type must be added to EVERY work-vs-absence classifier, and derived per-contract balances must be team-scoped.
---

Adding the paid compensatory-rest-day shift type ("freizeitausgleich", §11 Abs.3
ArbZG) as an absence had two non-obvious pitfalls that a code review caught:

1. **A new absence-type must be threaded through every independent work/absence
   classifier, not just one.** The engine has multiple, separately-defined
   predicates that decide "is this work vs. absence": `isAbsenceType`
   (shift-metrics-resolve.ts), a local `isWorkShift`/`isWorkEntry`/trackedHours
   check in dashboard-hours-balance.ts, and `findPlannedWorkShiftsForDay`'s
   `notInArray(type, [...])` in shifts.ts. Missing any one silently mis-classifies
   the new type (counted as work in Soll/Ist, or deleted as "replaced work" when
   an absence is booked on the same day).
   **Why:** these predicates were written inline at different times and are NOT
   derived from a single shared list, so grep for the type name across all of
   api-server before assuming a new shift type is fully wired.
   **How to apply:** when adding any shift type, search every `type !== "vacation"`
   / `notInArray(type, ["vacation","sick"])` style check and update in lockstep.
   dashboard-hours-balance.ts is intentionally DB/Express-free — duplicate a local
   ABSENCE_SHIFT_TYPES set there rather than importing from a DB-coupled module.

2. **Balances derived from shifts must be team-scoped, not just user-scoped.**
   A per-contract balance (vacation-balance endpoint) that aggregates shifts by
   `userId` alone leaks/contaminates across teams for multi-team users. Scope by
   `contract.teamId` (matches the repo-wide team-isolation invariant).

3. Holiday detection (`isGermanHoliday`) is UTC-based. When deriving a calendar
   day from a timestamptz in SQL, cast to a UTC "YYYY-MM-DD" string
   (`TO_CHAR(col AT TIME ZONE 'UTC', 'YYYY-MM-DD')`) and parse with a `Z` suffix —
   node-postgres' DATE() can return a Date object at session-local midnight,
   silently breaking string-based holiday lookups.
