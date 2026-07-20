---
name: E2E run lock at config load
description: PID lockfile prevents a parallel Playwright run from reaping the live run's servers; teardown must not import the config.
---

The managed E2E stack holds a PID lockfile (`node_modules/.cache/dienstplan-e2e/run.lock`), acquired at playwright.config load BEFORE the port-orphan reaping. Live lock owner (`kill(pid,0)`, EPERM counts as alive) → abort loudly; dead owner → take over and reap as usual.

**Why:** the orphan reaper kills everything on the test ports 8099/5199, so without the lock a second concurrent run silently killed the first run's servers.

**How to apply:**
- Any new config-load side effect that touches shared resources must run AFTER `acquireRunLock()`.
- `globalTeardown` releases the lock with its own duplicated logic — do NOT `import` playwright.config from teardown: re-evaluating the module in a fresh loader would re-run all side effects (reap, db setup) mid-teardown.
- Lock release only happens when the file still contains this process's PID; hard-aborted runs self-heal via the dead-PID check on the next start.
- A run killed by shell `timeout` leaves a stale lock whose PID may still look alive briefly (or the message names a dead PID); verify with `ps -p <pid>` and delete `run.lock` manually before retrying.
- Aborted runs can also leave zombie `e2e.*@dienstplan.test` accounts that break the separation check ("migrate-teams hat eine Mitgliedschaft HINZUGEFUEGT"): run `cleanup-test-accounts` with `DATABASE_URL` pointed at the `_test` DB, then retry.
- Don't run the full suite from an agent bash call (2-min timeout kills it; nohup-detached runs get reaped mid-suite). Use the registered `e2e-api` workflow via restart_workflow and poll logs instead.

- Killing a `pnpm exec playwright test` shell (timeout/SIGKILL of the pipe) leaves the actual Playwright node process ALIVE and holding the run lock; wait for that PID to exit (check `head -1 run.lock` + `kill -0`) instead of deleting the lock.
