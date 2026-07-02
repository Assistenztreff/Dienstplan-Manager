---
name: Stale e2e test DB & non-interactive db push
description: The `<dbname>_test` DB drifts after schema changes; drizzle-kit push can block on interactive truncate prompts, requiring manual guarded SQL repair.
---

The isolated e2e test DB (`<dbname>_test`) does NOT auto-heal after schema changes.
Symptom: registrations/inserts 500 with "column ... does not exist"; `setup-test-db` fails.

**Why:** `drizzle-kit push` asks interactively when a change looks data-lossy (e.g. adding
a UNIQUE constraint to a populated table → "Do you want to truncate?"), and dies with
"Interactive prompts require a TTY" in non-interactive shells. The rest of setup-test-db
then fails against the still-stale schema.

**How to apply:** When e2e specs fail with unknown-column 500s, run `setup-test-db` and read
its output. If push blocks on a prompt, repair the test DB manually with guarded SQL
(`CREATE TYPE ... EXCEPTION WHEN duplicate_object`, `ADD COLUMN IF NOT EXISTS`,
pg_constraint-guarded `ADD CONSTRAINT`), then re-run `setup-test-db` — once the diff is
empty, push passes and setup is idempotent again. Derive the test DB URL from
`DATABASE_URL` + `_test` suffix.

Note: running a single spec via `pnpm exec playwright test <name>` bypasses the
`test:e2e` npm script and therefore SKIPS setup-test-db — after any schema change,
run `pnpm --filter @workspace/scripts run setup-test-db` once first. Purely additive
drift (new nullable/defaulted columns) pushes cleanly without prompts.
