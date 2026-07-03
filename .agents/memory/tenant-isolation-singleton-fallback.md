---
name: Global-singleton-to-owner-scoped migration pattern
description: How to safely convert a fixed-id global settings table (branding, allowances, etc.) into an owner-scoped table with team overrides, and the DB-push pitfalls involved.
---

When a feature starts as a single global settings row (fixed id, e.g. `id=1` singleton) and turns out to need per-tenant isolation, the fix is: drop the fixed-id/check-constraint pattern, add a unique `ownerId` FK to `usersTable` (cascade delete), and resolve reads via a helper that walks the caller's own team ownership (or their employer's ownerId if they're an assistant) — same shape as the existing `allowance_settings` account+team-override pattern. Optional per-team override rows stay unique on `teamId`.

**Why:** a global fallback row that any authenticated admin can PUT to is a cross-tenant tampering/disclosure bug (any tenant can overwrite or read another tenant's "default" branding, etc.) — the fixed id made it trivially shared state instead of scoped state.

**How to apply:** when migrating, `drizzle-kit push` will likely hit two non-interactive blockers: (1) adding a UNIQUE constraint to a populated table triggers a TTY-only truncate prompt (`Interactive prompts require a TTY`) — clear/handle the offending rows manually via SQL first; (2) altering an `integer` PK column to `serial` on an existing table can literally fail with `type "serial" does not exist` (drizzle-kit generates a raw `SET DATA TYPE serial` which isn't valid outside `CREATE TABLE`) — fix manually via `DROP DEFAULT` + `CREATE SEQUENCE ... OWNED BY` + `SET DEFAULT nextval(...)` before re-running push.
