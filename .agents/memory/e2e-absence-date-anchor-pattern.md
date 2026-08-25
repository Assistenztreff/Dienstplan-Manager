---
name: e2e absence-fixture date anchoring
description: How to pick hardcoded/rebased calendar dates in e2e specs that create shifts or absences, so they don't rot as real time advances or silently invert chronological order.
---

Absence/shift e2e fixtures that hardcode or year-bump calendar dates can trip **two independent, real business guards**, not just one:

1. A past-date delete guard — trips once a hardcoded date has drifted into the past and the fixture is cleaned up through the real delete API route.
2. A forward-planning guard — blocks any shift/absence write more than the team owner's plan allows (calendar-months ahead of "today"), enforced for single AND bulk writes regardless of role.

**Why a flat "+1 year" bump is not enough:** it only stays safe if every month used in the file is ≤ today's real month. A month later in the calendar year than "today" can overshoot the forward-planning cap once the year is bumped.

**Why an independent "nearest future occurrence per month" resolver is not automatically safe either:** resolving each date's year independently can invert chronological order between an early-month anchor (e.g. a contract start that must roll to next year for its buffer) and a late-month dependent date (e.g. a vacation date that doesn't need to roll). This silently breaks "date must be within contract period"-style validation whenever the dependent date ends up before the anchor's resolved year.

**Robust pattern:** anchor the scheme's reference date (e.g. contract start) at "today + small buffer, day 1" — not a fixed calendar month — then express every *other* test date in the file as a **month/day offset from that single anchor**, preserving the original relative spacing between test cases (often needed for collision avoidance). Building offset dates via a UTC date constructor lets overflowing days (e.g. day 30 in a short month) normalize automatically into the next month, so no offset combination can ever produce an invalid calendar date. This guarantees both the forward-planning cap and chronological order after the anchor, by construction, regardless of which real month the suite happens to run in.

**UTC-overflow normalization prevents invalid dates, NOT collapsed/duplicate ones.** A day like 29/30/31 requested for a short month (a Feb landing on the anchor+N offset) silently rolls into the next month instead of throwing — so it never crashes, but it CAN land on the exact same calendar day as a date meant for "the next month offset," collapsing what the test assumed were N distinct chronological days into fewer real ones (e.g. a 4-day month-boundary fixture silently becoming a 2-day one, breaking count/skip assertions). Any test needing multiple genuinely distinct days within one month-offset must keep all of them ≤ 28 (every calendar month has at least 28 days); only rely on 29+ for a day that's alone in its month-offset.

Reserve independent real-calendar-month resolution only for dates that must be a genuine real-world month (e.g. an actual DST transition day) — safe in isolation only when that date has no ordering dependency on other anchor-derived dates in the same file (e.g. it isn't validated against a contract-period-style bound).

Not every date-with-year-arithmetic in a test suite is unsafe — relative-to-now patterns (e.g. "last month" snapshots) don't hit either guard. Only rework a fixture once it demonstrably risks one of the two guards above; don't speculatively rewrite dates that are already safe.

**Precise risk signal for a hardcoded absolute date (not a computed offset):** it only silently rots if an absence-typed row built from it is later deleted through the real delete API route — that's what re-checks the past-date guard against current time. The forward-planning guard only fires at authoring/run time on writes too far *ahead*; a stale past date is never blocked on create, so a plain hardcoded past date that's never API-deleted through that route is permanently safe. Cleanup via a DB-level helper that deletes rows directly bypasses the guard entirely — files using only that kind of cleanup are not at risk regardless of how old their hardcoded dates get.

**Automated guard exists:** a checker script scans specs that create an absence for hardcoded ISO date literals (including inside template-literal timestamps) and fails on any hit outside a baseline of individually-justified exceptions. It intentionally does not flag every date-with-year-math, only literal calendar dates — a logic bug like the independent-per-month-resolver anti-pattern above must still be caught by code review, not by this pattern-matching check.

**Baseline identity must be file+line+exact-text, not just file or file+text.** Keying an exemption by file name alone (or even by "file + matching source text") lets a brand-new hardcoded date anywhere in an already-exempted file silently inherit that file's justification just by reusing identical text — defeating the "every new hardcoded date needs its own reviewed justification" guarantee. Bind each baseline entry to a specific line location, and also store the expected line text so a shifted/edited line fails closed (forces a deliberate baseline update) instead of silently keeping a stale exemption.
