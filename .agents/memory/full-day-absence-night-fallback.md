---
name: Full-day absence night-hour fallback
description: How nightHours are estimated for a plain full-day vacation/sick entry with no concrete time reference, and which absence types stay untouched.
---

`resolveShiftMetrics` (artifacts/api-server/src/lib/shift-metrics-resolve.ts) previously always zeroed
`nightHours` for a "plain full-day" absence (00:00–23:59 sentinel, no replaced shift, no chosen shift model) —
Sunday/holiday surcharges were already derived correctly from `plannedHours`, but night was a real gap since
there is no true personal default shift model in the data model.

**Decision:** estimate night hours for that gap case using the team's first active shift model's default
times (`sortOrder ASC, id ASC` — same convention as `shift-dialog.tsx`'s `firstModel = activeModels[0]`),
via a new optional `fallbackNightBasis` input and the shared `deriveDayWindowFromDefaults` helper.

**Why:** user explicitly confirmed this team-wide approximation is acceptable (no per-person default exists),
and wanted night/Sunday/holiday surcharges captured for vacation/sick booked with no time reference (e.g. a
summer vacation booked before any shifts exist for that period), not just when replacing an already-planned
shift.

**How to apply:**
- `kind_krank` and `abgesagt_an` (unpaid) are checked BEFORE the fallback branch and always stay fully
  zero — never wire `fallbackNightBasis` behavior into those paths.
- Both the single POST `/api/shifts` (`storeShiftMetrics`) and `POST /api/shifts/bulk-absence` call
  `firstActiveShiftModelDefaults(teamId, dbx)` and pass the result as `fallbackNightBasis`; the bulk route
  loads it once for the whole date range (team is constant).
- The old duplicate local `shiftModelTimesForDay` helper in `shifts.ts` was replaced by importing the shared
  `deriveDayWindowFromDefaults` from `shift-metrics-resolve.ts` (identical logic, now single source of truth).
- The generic bulk shift route (~line 2020, never absence type) does NOT need this wiring.
