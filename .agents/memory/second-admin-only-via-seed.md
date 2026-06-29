---
name: Second admin/dienstleister can't be created via API
description: Why team-isolation E2E tests need a seed script to create a foreign admin actor.
---

A user's `role` (admin/assistant) and `accountType` cannot both be set via the public API:
- `UserInput` (POST /users) accepts `role` but new admin-role users have no password and can't be invited (the invite endpoint is assistant-only).
- `UserUpdate` (PATCH /users/:id) has NO `role` field, so an assistant (who can get a password via invite) can't be promoted to admin.

**Consequence:** To test the IDOR-404 path on by-id endpoints (GET /shifts/:id, /contracts/:id, /time-tracking/:id), you need a *second* admin whose allowed teams exclude the row — and that admin can only be created by seeding (the `setup-admin` script via `pnpm --filter @workspace/scripts run setup-admin` with ADMIN_EMAIL/ADMIN_PASSWORD env). The script is idempotent and skips team creation when any team already exists, giving a clean zero-team "attacker" admin.

**Cleanup gotcha:** DELETE /users/:id has an IDOR guard — the target must be a member of one of the caller's allowed teams. A zero-team seeded admin therefore can't be deleted directly; add it to one of your teams first, then delete (team_members cascade removes the membership).

**Test-DB targeting gotcha:** Under the managed E2E stack the API runs against the `<db>_test` database, but the worker process inherits the *dev* `DATABASE_URL`. A naive `setup-admin` execSync seeds the foreign admin into the dev DB, so the later login against the test DB fails ("Fremd-Admin-Login fehlgeschlagen"). The harness must pass the test-DB URL to the seed: the playwright config exports it as `E2E_TEST_DATABASE_URL` (set in the config module body so it propagates to workers) and `seedForeignAdmin` overrides `DATABASE_URL` with it when present. Against an external/proxy stack the var is unset and the existing `DATABASE_URL` applies.

**How to apply:** Any cross-tenant/isolation test that needs a foreign admin actor must seed it; pure-API promotion is impossible by design. If seeding must hit a specific DB (managed test stack), route the seed's `DATABASE_URL` through `E2E_TEST_DATABASE_URL`.
