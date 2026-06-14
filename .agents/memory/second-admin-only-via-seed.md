---
name: Second admin/dienstleister can't be created via API
description: Why team-isolation E2E tests need a seed script to create a foreign admin actor.
---

A user's `role` (admin/assistant) and `accountType` cannot both be set via the public API:
- `UserInput` (POST /users) accepts `role` but new admin-role users have no password and can't be invited (the invite endpoint is assistant-only).
- `UserUpdate` (PATCH /users/:id) has NO `role` field, so an assistant (who can get a password via invite) can't be promoted to admin.

**Consequence:** To test the IDOR-404 path on by-id endpoints (GET /shifts/:id, /contracts/:id, /time-tracking/:id), you need a *second* admin whose allowed teams exclude the row — and that admin can only be created by seeding (the `setup-admin` script via `pnpm --filter @workspace/scripts run setup-admin` with ADMIN_EMAIL/ADMIN_PASSWORD env). The script is idempotent and skips team creation when any team already exists, giving a clean zero-team "attacker" admin.

**Cleanup gotcha:** DELETE /users/:id has an IDOR guard — the target must be a member of one of the caller's allowed teams. A zero-team seeded admin therefore can't be deleted directly; add it to one of your teams first, then delete (team_members cascade removes the membership).

**How to apply:** Any cross-tenant/isolation test that needs a foreign admin actor must seed it; pure-API promotion is impossible by design.
