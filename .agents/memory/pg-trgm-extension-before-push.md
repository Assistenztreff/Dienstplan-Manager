---
name: pg_trgm / extension-dependent indexes break Replit publish
description: Why trigram GIN (or any extension-dependent) indexes are a bad fit for schemas published to Replit production, and what to do instead.
---

# Extension-dependent indexes (pg_trgm GIN) don't survive Replit publish

A Drizzle schema index using `gin_trgm_ops` (trigram GIN, e.g. for fast ILIKE
search on a note/reference column) requires the `pg_trgm` extension to exist in
the target DB before `drizzle-kit push` runs its `CREATE INDEX` — `push` never
creates extensions itself.

**Why this bites in production:** dev/test push paths can be made to run
`CREATE EXTENSION IF NOT EXISTS pg_trgm` first (post-merge, setup-test-db), but
the **Replit Publish flow does not** — it only applies the dev→prod schema
diff, and it cannot `CREATE EXTENSION` on the managed production DB. So an
extension-dependent index publishes fine in dev yet fails the production publish
("pg_trgm not enabled" / CREATE INDEX error). You must not add prod DDL, hooks,
or startup DDL to work around it — see `database-migrations-on-publish`.

**Decision (applied):** the trigram GIN index on `plan_changes.note` was
removed entirely. The operator-dashboard note search is plain
`ilike(..., '%term%')` and stays fully functional without the index (just a
sequential scan; the audit log is small). The `CREATE EXTENSION pg_trgm` steps
were also removed from `post-merge.sh` and `setup-test-db.ts` since nothing else
used the extension.

**How to apply:** for any schema that will be published to Replit production,
avoid indexes/column types that need a Postgres extension. If a genuine
performance need for trigram/GIN search ever returns, it cannot be solved purely
in the schema — it needs the extension enabled on production through a supported
mechanism, which the publish flow does not provide.
