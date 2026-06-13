---
name: Singleton settings table pattern
description: How global single-row config tables (e.g. allowance_settings) are kept to exactly one row in this repo
---

# Singleton settings tables (global config)

For app-wide config that is a single row (e.g. `allowance_settings`, id fixed at 1):

- **Enforce one row at DB level**: `id integer primary key default 1` PLUS a check
  constraint `CHECK (id = 1)`. In Drizzle: `(t) => [check("..._singleton", sql`${t.id} = 1`)]`.
  Without the constraint, the default-1 primary key still allows other ids → silent drift.
- **Race-safe ensure/read**: do an upsert, not read-then-insert.
  `INSERT ... VALUES({id:1, ...defaults}) ON CONFLICT DO NOTHING`, then `SELECT` the row.
  Drizzle: `.insert(table).values({...}).onConflictDoNothing()` then select by id=1.
  Read-then-insert races two concurrent first requests into a unique-violation 500.

**Why:** architect review flagged that a default-1 PK alone is not a true singleton,
and read-then-insert has a first-hit race. These two fixes make the pattern correct.

**How to apply:** reuse for any future global settings table. Constraint must be added
via raw SQL DDL too (drizzle-kit push needs a TTY in this env — see drizzle-push-tty.md).

# Form hydration from a settings query (frontend)

When a form is seeded from a React Query result, hydrate **once** (guard with a
`useRef` flag), not on every `settings` change. React Query refetches (focus/reconnect/
invalidate) would otherwise clobber the admin's unsaved edits.
