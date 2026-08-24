---
name: § 4 BUrlG Wartezeit-Sockel-Proration
description: How the statutory vacation waiting-period proration works, where it plugs in, and which e2e fixtures assume a fully-accrued sockel.
---

## The rule
During the first 6 full months of employment (anniversary-day counting from `contract.startDate`, not calendar months), the guaranteed vacation base ("Sockel", not the overtime-earned "Aufbau") accrues at `fullMonths/12`. From the day the 6th full month is reached, the full annual sockel applies immediately for the rest of the calendar year. Computed live from `startDate` + a reference date on every read — nothing is stored, so it applies retroactively to existing contracts with no migration.

`waitingPeriodProrationFactor(startDate, refDate)` in `artifacts/api-server/src/lib/vacation-hours.ts` is the single source of truth. `vacationPoolHours()` takes optional `startDate` (on the contract param) and `refDate` (defaults to `new Date()`); omitting `startDate` = factor 1 (full backward compatibility for callers that don't have it).

## Multiple call sites — keep them in sync
`vacationPoolHours()` (the sockel) is rendered in at least three places that must all pass `startDate`/`refDate` through to stay consistent: the single contract vacation-balance route, the batch vacation-balances route, and `dashboard-hours-balance.ts` (Dashboard/Auswertungen — easy to miss since it doesn't live under `routes/contracts.ts`). Before changing sockel math again, grep all `vacationPoolHours(` call sites, not just the contracts routes.

## Data-entry gotcha: startDate defaults to "today" when a contract is entered late
Real customer data showed contracts entered into the system long after the employee's actual hire date, where `startDate` was left at the contract-creation date instead of being backdated to the true hire date. Result: the Wartezeit factor fires as if they were freshly hired, even though they've worked all year — Sockel drops to a tiny `fullMonths/12` fraction (e.g. 11h instead of ~132h) and the 13-week forecast also disappears (needs contract age ≥91 days). The math was correct; the input was wrong. Established convention for genuinely long-tenured staff in this dataset: `startDate` is manually backdated to their real hire year (seen: 2019-01-01, 2025-01-01). When a user reports "too little remaining vacation despite working all year," check `contracts.start_date` vs. `created_at` first — a near-match is the tell.

## e2e fixtures assuming full accrual
Any existing fixture using a `startDate` less than ~6 months before "now" and then asserting a specific numeric `vacationDaysRemaining` / `vacationHoursTotal` / `vacationSockelHours` value will now get a prorated (smaller) number instead of the old hardcoded expectation. `vacationHoursUsed`-only assertions are unaffected (usage tracking, not the sockel total). When adding new vacation-math-adjacent logic, grep `vacationDaysRemaining\|vacationHoursTotal\|vacationSockelHours\|vacationHoursRemaining` across `e2e/*.ts` and check each fixture's effective contract age against "today" — fixtures that need mid-month-start reproduction but must NOT trip proration should shift the whole scenario further into the past (e.g. 8 months back) rather than dropping the mid-month property.
