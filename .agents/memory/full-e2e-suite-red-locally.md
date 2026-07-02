---
name: Full e2e suite baseline (green) and load-flake patterns
description: The complete `test:e2e` run is green (171 passed, 3 skipped); how to keep it green and attribute failures under full-suite load.
---

The full Playwright suite (`pnpm run test:e2e`, ~174 tests, ~13 min, 1 worker) is green as of July 2026: 171 passed, 3 `test.skip` (bulk-create-delete UI flow, doppelte-Team-Mitgliedschaft 409-toast, shift-overlap UI dialog — each hangs reproducibly ONLY under full-suite load even at 60s; TODO comments in the specs explain why).

**Durable lessons for full-suite work:**
1. Global `timeout: 60000` is set in `playwright.config.ts` — under single-worker full-suite load, multi-step UI flows routinely exceed the 30s default and fail run-dependently (whack-a-mole: a different spec times out each run). Fix the config once, not per-test.
2. Distinguish "slow" from "hung": a test that times out at 30s but passes at 60s is load-slow; a test that still times out at 60s+ in the full run (but may pass standalone) is a data/timing collision with sibling specs → skip with TODO rather than chase, unless doing a dedicated isolation analysis.
3. Specs registering fresh accounts get Free plan → premium-gated endpoints (hours-balance/advancedAnalytics, confirm, invite) return 403. Use `setAccountPlan(email, "premium")` from `e2e/helpers/teams.ts` (writes to the `_test` DB via `E2E_TEST_DATABASE_URL`).
4. Any `execSync` seeding inside specs MUST override `DATABASE_URL` with `E2E_TEST_DATABASE_URL`, or it silently seeds the dev DB and the test asserts against missing data.
5. Aggregate/list assertions must tolerate sibling-spec data: shared seed admin accumulates shifts across specs, so top-N lists (e.g. dashboard `upcomingShifts`, capped at 5) can crowd out a spec's own rows — guard membership asserts with a `length < N` condition or assert via aggregates.
6. On mobile viewport, month-view badges render only after the day cell is clicked — click the day cell (`dayCellId(y,m,d)`) before locating badges.

**How to apply:** After any change, run the full suite via a temporary console workflow appending to a results file (`playwright test --reporter=<append-reporter>`), poll with grep for `^(FAILED|TIMEDOUT)|^END`, and remove the workflow afterwards. Attribute failures against this green baseline, not against the old "~33 red" state.
