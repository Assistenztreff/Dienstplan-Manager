---
name: Idempotent ADD UNIQUE/PK constraint in raw migrations
description: Re-adding a UNIQUE/PK constraint raises 42P07 (duplicate_table), not 42710 (duplicate_object).
---

When a raw-SQL migration re-runs `ALTER TABLE ... ADD CONSTRAINT <name> UNIQUE
(...)` (or PRIMARY KEY) and that constraint already exists, Postgres raises
`42P07 relation "<name>" already exists`, i.e. `duplicate_table` — NOT
`42710 duplicate_object`.

**Why:** Adding a UNIQUE/PK constraint first creates a backing *index relation*
named after the constraint. That relation name collides before the constraint
check fires. FK and CHECK constraints do not create a backing relation, so they
correctly raise `duplicate_object`.

**How to apply:** A bare `EXCEPTION WHEN duplicate_object THEN null` guard is NOT
enough for UNIQUE/PK — it silently fails the migration. Guard them with an
explicit `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '<name>')`
check and catch `duplicate_object OR duplicate_table`. This bit the
migrate-teams script: post-merge runs the migration on an already-migrated DB,
so every constraint re-add must truly be idempotent. Also note the post-merge
script (`pnpm install` + migrate + `db push`) needs a generous timeout (~180s);
the monorepo install alone is ~20s.

**Related:** `drizzle-kit push` prompts interactively when it wants to ADD a
UNIQUE constraint to an existing table (even with `--force`, the truncate
question still requires a TTY). Non-interactive runs (agent shell, post-merge)
die with "Interactive prompts require a TTY". Fix: pre-apply the column +
constraint with guarded raw SQL (psql heredoc in post-merge.sh) BEFORE
`db push`; push then reports "no changes".

**Gotcha:** drizzle-kit push EXITS WITH CODE 0 even when it aborts with the TTY
error — exit-code checks alone miss the failure and downstream steps run against
the stale schema. Detect failure by capturing stdout+stderr and matching the
error text ("Interactive prompts require a TTY" / `^Error:`).

The e2e test DB (`<dbname>_test`) is self-healing: `setup-test-db` captures the
push output, and on any push failure drops the disposable test DB
(`DROP DATABASE ... WITH (FORCE)`), recreates it, and pushes again — no manual
SQL pre-apply needed there (only post-merge.sh needs guarded SQL, since the dev
DB is not disposable).
