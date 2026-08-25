---
name: e2e absence-fixture date anchoring
description: How to pick hardcoded/rebased calendar dates in e2e specs that create shifts or absences, so they don't rot as real time advances or silently invert chronological order.
---

Absence/shift e2e fixtures that hardcode or year-bump calendar dates can trip **two independent, real business guards**, not just one:

1. `absence_delete_past_blocked` — trips once a hardcoded date has drifted into the past.
2. `forwardPlanningBlocked` (`artifacts/api-server/src/routes/shifts.ts`) — blocks any shift/absence write more than the team owner's plan's `historyMonths` calendar-months ahead of "today" (Free=1, Premium=12), enforced for single AND bulk writes regardless of role.

**Why a flat "+1 year" bump is not enough:** it only stays safe if every month used in the file is ≤ today's real month. A month later in the calendar year than "today" can overshoot the 12-month cap once the year is bumped.

**Why an independent "nearest future occurrence per month" resolver (e.g. `futureYearFor(month)`) is not automatically safe either:** resolving each date's year independently can invert chronological order between an early-month anchor (e.g. a January contract start, which must roll to next year for its buffer) and a late-month dependent date (e.g. a September vacation, which doesn't need to roll). This silently breaks `vacation_outside_contract` validation for "vacation"-type absences whose date ends up before the contract's resolved start.

**Robust pattern:** anchor the scheme's reference date (e.g. contract start) at "today + small buffer (e.g. 1 month), day 1" — not a fixed calendar month — then express every *other* test date in the file as a **month offset from that anchor**, preserving the original relative spacing between test cases (often needed for collision avoidance). This guarantees total span stays within the forward-planning cap and chronological order after the anchor by construction. Reserve independent real-calendar resolution (`futureYearFor`) only for dates that must be a genuine real-world month (e.g. an actual DST transition day) — by construction those still resolve after a small-buffer-anchored start.

Not every `${YEAR}`/`getFullYear()`-based date in this test suite is unsafe — relative-to-now patterns (e.g. "last month" snapshots) don't hit either guard. Only rework a file once it demonstrably risks one of the two guards above; don't speculatively rewrite dates that are already safe.
