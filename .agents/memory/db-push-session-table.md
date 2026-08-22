---
name: DB push & any raw-SQL-created table
description: Why EVERY table must be modeled in the Drizzle schema, even ones created via raw SQL (session store, rate-limit counters) — or push tries to drop them.
---

# Every real table must be in the Drizzle schema, not just app-domain ones

`drizzle-kit push` (and `check-prod-schema`/`migrate-prod`) diffs the LIVE DB against the Drizzle schema tree. Any table that exists in the DB but has no matching `pgTable` export is invisible to Drizzle and gets classified as "not in schema" — the generated diff then includes `DROP TABLE ... CASCADE` for it.

**Known instances of this trap:**
- `connect-pg-simple` (express-session store) creates a `session` table (sid varchar PK, sess json, expire timestamp(6), index on expire).
- Any table created via raw `CREATE TABLE IF NOT EXISTS` in app startup code (e.g. `ensureRequiredTables()` in `index.ts`) for things like per-IP rate-limit counters — easy to add one such table (e.g. `email_rate_limit_attempts`) to the Drizzle schema and forget a sibling added later (e.g. `register_rate_limit_attempts`), leaving it undeclared.

**Rule:** every table that exists in the real DB — no matter how or why it was created — needs a matching Drizzle table definition in `lib/db/src/schema/`, exported from the schema index, with column/index names matching exactly.

**Why:** the post-merge script and `migrate-prod` run `drizzle-kit push` non-interactively; a DROP/data-loss statement makes it exit with "Interactive prompts require a TTY", so schema sync silently fails — or worse, an explicit `--yes`/non-interactive flag could let it actually drop a live table. Always read `check-prod-schema`'s dry-run statement list before trusting a push is safe; a `DROP TABLE ... CASCADE` on a table you recognize as intentional means the schema file is missing it, not that the table should go away.

**How to apply:** after adding any raw-SQL-managed table, immediately add its Drizzle counterpart. Before running `migrate-prod` for real, run the read-only `check-prod-schema` dry run first and scan for unexpected DROP statements.
