---
name: Backdating append-only audit rows for e2e time-window tests
description: How e2e specs get plan_changes entries with controlled timestamps (created_at is always server-set "now").
---

plan_changes.created_at is server-set and append-only — no API can backdate it (intentional). Time-window specs (month presets, from/to filters) therefore seed rows via normal plan flips with UNIQUE note strings, then run the `backdate-plan-change` script (env BACKDATE_PLAN_CHANGE_NOTE / _CREATED_AT, same execSync/E2E_TEST_DATABASE_URL convention as set-plan) to move created_at.

**Why:** proving boundary-inclusive server filtering (first/last day of month) needs deterministic timestamps in adjacent months.

**How to apply:** for UI preset tests, run the browser context with `timezoneId: "UTC"` so the preset's local-date math matches the UTC backdates exactly; identify rows by a shared unique note prefix and filter the table via the search box before asserting counts.
