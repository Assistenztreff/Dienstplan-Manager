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

Note: single-spec runs via `pnpm exec playwright test <name>` no longer skip setup —
the playwright config runs setup-test-db at load time (managed stack, main process only),
and setup-test-db self-heals a blocked push by drop+recreate of the throwaway test DB.
A schema-marker hit alone must never skip setup blindly: the fingerprint proves the
sources were seen, not that the DB matches. The durable pattern is to verify the
actual DB structure (information_schema vs. Drizzle tables/columns) on every marker
hit and after every push, and to re-provision on any missing table/column — drift
then self-heals regardless of why the marker and the DB disagreed.
Manual guarded-SQL repair is only needed if the DEV DB (not the `_test` one) drifts.
Purely additive drift (new nullable/defaulted columns) pushes cleanly without prompts.

Standalone verify-* scripts that seed directly into the `_test` DB hit this drift too
(e.g. enum values added after the test DB was created → 22P02 invalid enum input).
Pattern: probe pg_enum/pg_attribute for a recently-added schema element and, on miss,
re-run `setup-test-db` (self-heals via drop+recreate) before seeding.
