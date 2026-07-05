---
name: pg_trgm extension before db push
description: A trigram GIN index needs the pg_trgm extension created in every DB that runs db push, before the push.
---

# pg_trgm extension must exist before db push

Any Drizzle schema index using `gin_trgm_ops` (trigram GIN index, e.g. for fast
text search on a note/reference column) requires the `pg_trgm` extension to
already exist in the target database, or `drizzle-kit push`'s `CREATE INDEX`
fails.

**Why:** `db push` does not create extensions. Dev DB was fixed once by hand,
but every other environment that runs push needs it too.

**How to apply:** Run `CREATE EXTENSION IF NOT EXISTS pg_trgm` (idempotent)
BEFORE `db push` in every push path:
- `scripts/post-merge.sh` (production/main reconciliation)
- `scripts/src/setup-test-db.ts` — both the initial push AND the drop+recreate
  rebuild path (a fresh `<db>_test` starts without the extension).
