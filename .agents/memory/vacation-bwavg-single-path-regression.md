---
name: bwavg vacation-average dropped from single-shift path
description: resolveDailyRateInfo (single POST /api/shifts vacation path) can silently lose the 13-week bwavg branch during refactors, even though the bulk-absence path keeps it — check both when touching vacation valuation.
---

## What happened

A refactor commit ("Update vacation hours logic...") removed the entire
§11-BUrlG 13-week-average (`bwavg`) branch from
`resolveDailyRateInfo`/`absenceHoursFor` in
`artifacts/api-server/src/lib/vacation-hours.ts`, believing it was an
intentional "AP 3" simplification (comment: "der 13-Wochen-Schnitt bewertet
keinen Urlaubstag mehr"). A later commit restored the same `bwavg` branch in
the **bulk**-absence path (`POST /api/shifts/bulk-absence` in
`artifacts/api-server/src/routes/shifts.ts`, via `isContractOlderThan13Weeks`
+ `bwavgDailyHoursForDates`) but never restored it in the **single**-shift
path (`POST /api/shifts` → `resolveVacationHours` → `absenceHoursFor` →
`resolveDailyRateInfo`). Result: a single vacation day always used
contract-hours or the flat default, never the confirmed work-history average,
even when `ops.vacationMethod === "bwavg"` and the contract was old enough.

**Why:** the two code paths (single POST vs. bulk POST) independently
duplicate the "is contract ≥13 weeks + has confirmed history" eligibility
check instead of sharing one implementation, so a fix/regression in one path
does not propagate to the other.

**How to apply:** whenever touching vacation-day valuation logic (bwavg,
contract fallback, default fallback), verify **both**
`resolveDailyRateInfo`/`absenceHoursFor` (single path) and the inline
`bwavg`-gated block in the `/shifts/bulk-absence` handler (bulk path) stay in
sync. The restored single-path chain: `ops.vacationMethod === "bwavg"` →
contract exists? → `contractOlderThan13Weeks` (>= 91 days, correct boundary)
→ `bwavgDailyHours` (null if no confirmed history) → else contract
`weeklyHours/workdaysPerWeek` → else flat default. Without a contract, the
old code still tries `bwavgDailyHours` unconditionally (bestandsschutz for
contract-less users). Covered by
`artifacts/dienstplan/e2e/dienstplan-urlaub-vertragsstunden-fallback-api.spec.ts`.
