---
name: Seed e2e data before page load (React Query cache)
description: API-seeded test data must exist before page.goto or cached queries won't show it in dialogs.
---

The frontend fetches lists (e.g. shift templates) via React Query on page mount and caches them. If an e2e spec creates data via `page.request.post(...)` AFTER `page.goto(...)`, dialogs opened later render the stale cached list and the new rows never appear — the spec fails with "option not found" even though the API insert succeeded.

**Why:** React Query serves the cached response from initial page load; there is no invalidation for out-of-band API writes made by the test.

**How to apply:** In specs, do all API seeding (templates, models, users) BEFORE `page.goto()`. If the target month/day matters (weekday-dependent data), compute it in Node (`today + N months`) instead of reading the UI month label first, then assert the label matches after navigating.

Related: killed/timed-out Playwright runs leave orphan webServer processes on ports 8099/5199 ("healthz already used"). `fuser -k 8099/tcp 5199/tcp` then wait/poll until `curl localhost:8099/api/healthz` fails before re-running — the port takes several seconds to release.
