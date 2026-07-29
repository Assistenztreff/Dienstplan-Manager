---
name: DB-backed register rate limit
description: Why the registration rate limiter counts in Postgres, why it needs a per-IP advisory lock, and how its tests dodge the shared _test DB.
---

**Rule:** The public-registration rate limiter counts attempts in the shared Postgres table `register_attempts` (one row per attempt). Count+insert run in a transaction that first takes `pg_advisory_xact_lock(hashtext('register-rate-limit:'||ip))`.

**Why:** The deployment target is Autoscale — multiple API instances can run, so per-process in-memory counters get more permissive with each instance. A single `INSERT…SELECT…WHERE count < max` statement is NOT enough: under READ COMMITTED, parallel transactions all see the same pre-insert count and all insert (verified by a stress run). The per-IP advisory xact-lock serializes contenders across instances without blocking other IPs. `MAX=0` (E2E stack) skips the DB entirely.

**How to apply:**
- Any new shared throttle/counter must be DB-backed AND serialized (advisory lock or equivalent) — never a bare conditional insert.
- DB-backed vitest files must re-point BOTH `DATABASE_URL` and `APP_DATABASE_URL` before dynamically importing `@workspace/db` — resolveDatabaseUrl prefers APP_DATABASE_URL, otherwise the pool silently hits the staging base DB.
- The limiter tests use their own throwaway DB (`<dbname>_rl_test`, self-provisioned: CREATE DATABASE + CREATE TABLE IF NOT EXISTS) instead of the shared `<dbname>_test`, which parallel task environments drop/recreate mid-run. Prefer this pattern for DB tests that need only a table or two.
- Keep `test:db` on `--no-file-parallelism`; remote-DB latency also means per-test timeouts of ~60s for transaction-heavy loops.
