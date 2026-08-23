---
name: § 4 BUrlG Wartezeit-Sockel-Proration
description: How the statutory vacation waiting-period proration works, where it plugs in, and which e2e fixtures assume a fully-accrued sockel.
---

## The rule
During the first 6 full months of employment (anniversary-day counting from `contract.startDate`, not calendar months), the guaranteed vacation base ("Sockel", not the overtime-earned "Aufbau") accrues at `fullMonths/12`. From the day the 6th full month is reached, the full annual sockel applies immediately for the rest of the calendar year. Computed live from `startDate` + a reference date on every read — nothing is stored, so it applies retroactively to existing contracts with no migration.

`waitingPeriodProrationFactor(startDate, refDate)` in `artifacts/api-server/src/lib/vacation-hours.ts` is the single source of truth. `vacationPoolHours()` takes optional `startDate` (on the contract param) and `refDate` (defaults to `new Date()`); omitting `startDate` = factor 1 (full backward compatibility for callers that don't have it).

## Multiple call sites — keep them in sync
`vacationPoolHours()` (the sockel) is rendered in at least three places that must all pass `startDate`/`refDate` through to stay consistent: the single contract vacation-balance route, the batch vacation-balances route, and `dashboard-hours-balance.ts` (Dashboard/Auswertungen — easy to miss since it doesn't live under `routes/contracts.ts`). Before changing sockel math again, grep all `vacationPoolHours(` call sites, not just the contracts routes.

## e2e fixtures assuming full accrual
Any existing fixture using a `startDate` less than ~6 months before "now" and then asserting a specific numeric `vacationDaysRemaining` / `vacationHoursTotal` / `vacationSockelHours` value will now get a prorated (smaller) number instead of the old hardcoded expectation. `vacationHoursUsed`-only assertions are unaffected (usage tracking, not the sockel total). When adding new vacation-math-adjacent logic, grep `vacationDaysRemaining\|vacationHoursTotal\|vacationSockelHours\|vacationHoursRemaining` across `e2e/*.ts` and check each fixture's effective contract age against "today" — fixtures that need mid-month-start reproduction but must NOT trip proration should shift the whole scenario further into the past (e.g. 8 months back) rather than dropping the mid-month property.
