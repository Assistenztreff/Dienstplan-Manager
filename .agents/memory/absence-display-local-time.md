---
name: Absence display must use local time, not UTC accessors
description: New UI helpers formatting a stored absence time-of-day must read local time (getHours/getMinutes), not getUTCHours/getUTCMinutes, or Europe/Berlin viewers see wall-clock-shifted times; API-only e2e specs (run in UTC) can't catch this.
---

## Rule
Any new display helper that formats the *time-of-day* portion of a stored
absence/shift instant must read it with the browser's **local** time
accessors (`getHours()`/`getMinutes()`, or date-fns `format()` which is
local-time-based) — matching the existing pattern used for normal shift
times (`toTimeString()`) and local-day helpers (`localDayKey()` using
`format(date, "yyyy-MM-dd")`). Never use `getUTCHours()`/`getUTCMinutes()`
for anything meant to reflect wall-clock time to the viewer.

**Why:** A half-day vacation stores its time window as a UTC ISO instant
(built from the browser's local input via `buildIso`). A new absence-range
display helper (`formatAbsenceTimeSpan`) was written using UTC accessors by
analogy with the UTC-based full-day sentinel check in the same file — but
the sentinel check is legitimately UTC (full-day storage is a fixed UTC
00:00–23:59 marker, not a viewer-facing time), while the time-span display
is viewer-facing and must be local. The bug only manifests for
Europe/Berlin viewers (UTC+1/+2 offset) and is invisible to API-only e2e
specs, which run in UTC and never render the value through a browser
timezone context.

**How to apply:** When adding any formatter that turns a stored ISO instant
into a human-readable time string, check whether nearby code has a UTC
sentinel check for a *different* reason (e.g. a fixed all-day marker) before
copying its accessor style — the sentinel's UTC-ness and the display's
local-ness are usually two separate, unrelated facts about the same file.
Cover this with a genuine browser/UI e2e spec using
`browser.newContext({ timezoneId: "Europe/Berlin" })` (see
`dienstplan-operator-fehler-zeitraum.spec.ts` for the pattern) — not just an
API spec — since only a real browser context reveals a local/UTC mismatch.

## Related: early-local-hour day-crossing guard
Separately, day-bucketing (`dayKey`) across this app is deliberately
UTC-calendar-day-based (a documented DST-neutral convention for full-day
sentinels and other day-boundary logic) — this is correct and must not be
changed broadly. But it means a user-entered *local* start time before the
Berlin UTC offset (e.g. 00:00–01:00 in winter, 00:00–02:00 in summer)
converts to the **previous** UTC calendar day via `buildIso`, which could
book/dedupe an absence against the wrong day even though the calendar grid
(which buckets by local day via `format()`) shows it on the intended day.
Guard this at input validation time (reject the local start time with a
clear message) rather than trying to change the storage/day-bucketing
convention.
