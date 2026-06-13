---
name: DB push & session table
description: Why the express-session table must be modeled in the Drizzle schema, and how that interacts with non-interactive post-merge pushes.
---

# Session table must be in the Drizzle schema

`connect-pg-simple` (express-session store) creates a `session` table (sid varchar PK, sess json, expire timestamp(6), index on expire). It is NOT part of app domain schema by nature.

**Rule:** model it as a Drizzle table in `lib/db/src/schema/` and export it from the schema index.

**Why:** `drizzle-kit push` diffs the live DB against the Drizzle schema. If `session` is absent from the schema, push reports it as a table to DROP ("data-loss statements"). The post-merge script runs `pnpm --filter db push` non-interactively, and drizzle-kit then errors ("Interactive prompts require a TTY") — so schema sync silently fails on every merge and live session rows are at risk.

**How to apply:** keep the Drizzle `session` table definition matching connect-pg-simple's structure exactly; do not change its columns/indexes. After any schema change verify `pnpm --filter @workspace/db run push` completes with "Changes applied" and no data-loss prompt.
