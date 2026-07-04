---
name: Task-agent DB migrations don't merge
description: Why post-merge `db push` can fail repeatedly after a schema-change task, and how to recover on main.
---

# Task-agent DB migrations do not propagate to the main dev DB

When an isolated task agent changes the Drizzle schema AND performs the required
data migration via manual SQL in its own environment, **only the code merges** —
the manual SQL never runs against the main repl's dev DB. The main dev DB stays on
the OLD schema, so the automatic post-merge `db push` hits the exact interactive
prompt the task agent sidestepped (e.g. "add UNIQUE constraint to table with N
items? truncate?") and dies on the non-TTY error. This repeats on **every**
subsequent merge until fixed on main, because each merge re-runs post-merge push
against the still-drifted DB.

**Why:** merge boundary = code only. DB state in a task agent's Repl is discarded.

**How to apply:**
- After merging a schema-change task, if post-merge setup fails on a drizzle-kit
  interactive prompt, the dev DB has drifted. Fix it on main in Build mode.
- Cleanest recovery when the affected table holds no real data (check row
  contents first — e.g. a leftover empty singleton row): `DROP TABLE IF EXISTS
  <t> CASCADE` after confirming no FK references it
  (`pg_constraint WHERE confrelid='<t>'::regclass AND contype='f'`), then
  `pnpm --filter @workspace/db run push` recreates it correctly with all
  constraints, no prompt.
- If the table holds real data, instead apply idempotent guarded SQL (ADD COLUMN
  IF NOT EXISTS, backfill, SET NOT NULL, guarded ADD CONSTRAINT) then push.
- Always restart the API-server workflow afterwards so it runs against the
  reconciled schema.
