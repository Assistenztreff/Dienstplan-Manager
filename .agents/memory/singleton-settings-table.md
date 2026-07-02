---
name: Singleton settings table pattern
description: Patterns for single-row-per-scope config tables; allowance_settings is now per-account (owner_id), no longer a global singleton
---

# Per-scope settings tables (was: global singleton)

`allowance_settings` is NO LONGER a global singleton (id=1 + CHECK). It is
per-account: `owner_id` NOT NULL UNIQUE FK→users.id (team-owner admin), one row
per admin account. The global row was a multi-tenant leak (any admin overwrote
percentages for everyone).

**Why:** surcharge percentages are tenant config; readers (hours-balance,
shift-metric storage) must resolve settings via the row's team → team owner →
owner's settings, not a global row.

**How to apply:**
- **Enforce one row per scope at DB level**: UNIQUE on the scope column
  (`owner_id`), not a fixed-id CHECK.
- **Race-safe ensure/read**: upsert, not read-then-insert.
  `.insert(table).values({ownerId, ...defaults}).onConflictDoNothing()` then
  select by ownerId. Read-then-insert races two concurrent first requests into
  a unique-violation 500.
- **Readers pick the owner's row**: joins go teams → allowance_settings on
  `teams.owner_id = allowance_settings.owner_id`, with hardcoded defaults as
  fallback when no row exists yet.
- Migration seeded one row per existing admin from the legacy global values
  (idempotent script, runs in post-merge before db push and in setup-test-db).

# Form hydration from a settings query (frontend)

When a form is seeded from a React Query result, hydrate **once** (guard with a
`useRef` flag), not on every `settings` change. React Query refetches (focus/
reconnect/invalidate) would otherwise clobber the admin's unsaved edits.
