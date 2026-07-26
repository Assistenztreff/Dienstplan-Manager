---
name: 401 self-heal in web client
description: How the Dienstplan web app recovers from dead sessions (e.g. after a DB restore wipes the session table)
---

**Rule:** Any DB reset/restore wipes `session` rows; browsers with the old `connect.sid` cookie then get looping 401s while the DEV localStorage profile cache (`assistenz_treff_session`) makes the UI look logged in (empty calendar, no data).

**Why:** Happened after the dev→staging pg_restore (DROP SCHEMA). Server was fine (curl worked); only stale browser sessions broke.

**How to apply:** The client now self-heals: `QueryCache.onError` in App.tsx catches `ApiError` 401 → `resyncAuthAfter401()` (single-flight bootstrap: me → dev-login → clear state, 15s cooldown) → `invalidateQueries()` on success. When debugging "empty pages + 401 loop" reports, suspect stale browser session first, not missing data; verify via curl + fresh Playwright context before touching data or schema.
