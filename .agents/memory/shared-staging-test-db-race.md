---
name: Shared staging _test DB race
description: The external staging Postgres `_test` DB is shared across parallel task environments; concurrent e2e runs pollute each other.
---

The e2e `_test` database lives on the external staging Postgres (APP_DATABASE_URL), so EVERY parallel task environment's e2e runs share it. Fresh `e2e.*` accounts can appear mid-run from other environments, breaking the account-separation pre-check even after a clean drop/reprovision.

**Why:** the run lock is a local PID file — it cannot serialize runs across isolated environments.

**How to apply:** for a one-off local spec verification, clean leftover `e2e.*` accounts via cascade SQL (team-owned tables first) and run with `E2E_SKIP_SEPARATION_CHECK=1 E2E_SKIP_CLEANUP_CHECK=1`. Don't burn cycles reprovisioning — pollution can recur seconds later. psql to staging: strip `sslmode` param from the URL and set `PGSSLMODE=require`.

Foreign runs' teardown also DELETES all `e2e.*@dienstplan.test` accounts mid-run: a superadmin seeded in `beforeAll` can vanish before/inside a test (login fails, or session dies mid-test with "Nicht angemeldet"). Seed a FRESH uniquely named account inside each test immediately before login; non-account rows (e.g. platform_errors with own context prefixes) are safe.
