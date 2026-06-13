---
name: Shift metrics & surcharge architecture
description: How valued/night/sunday/holiday hours and surcharges are computed and stored in the Dienstplan app.
---

Per-shift RAW metrics (`valued_hours`, `night_hours`, `sunday_hours`, `holiday_hours`) are computed at save time (POST/PATCH `/shifts`) by the pure module `lib/db/src/shift-metrics.ts` and stored on the `shifts` row.

**Rule:** surcharge *percentages* (night/sunday/holiday) are NOT baked into stored values — they are applied only at evaluation time in the `hours-balance` dashboard endpoint, reading current percents from `allowance_settings` (singleton id=1).

**Why:** changing a surcharge rate must apply retroactively to past shifts without recomputing/rewriting historical rows.

**Details/conventions:**
- All time math is UTC; night window ("23:00"–"06:00") interpreted as UTC wall-clock, overlap computed per-day incl. previous day for early-morning shifts.
- Holiday takes precedence over Sunday (no double surcharge). Federal holidays only; Easter via Meeus/Jones/Butcher.
- Absences (vacation/sick): surcharge buckets (night/sunday/holiday) = 0, but `valuedHours` = full planned daily target (active contract `weeklyHours/5`, fallback 8) so absences count as fulfilled hours. Set in `storeShiftMetrics`, not in the pure `computeShiftMetrics` (which still returns 0 for `isAbsence`).
- `valuationPercent` from the shift model (type "work" + shiftModelId); legacy types / no model → 100.
- `parseHm` clamps malformed allowance times to 0–23 / 0–59 defensively.
