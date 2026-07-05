---
name: becomeDienstleister harness blocked by accountType guard
description: The e2e TeamTestHarness.becomeDienstleister helper is broken by the account-type-fixed security guard; how to write dienstleister-free specs instead.
---

# becomeDienstleister is blocked by the account-type guard

`TeamTestHarness.becomeDienstleister()` PATCHes `/api/users/:id {accountType:"dienstleister"}`.
The users route now hard-blocks any REAL accountType change with 403 (escalation-chain
security guard). The `_test` DB admin (`admin@dienstplan.local`) is seeded `privat`
(schema default; setup-test-db only promotes to premium, never dienstleister), so
`becomeDienstleister` returns 403 → `expect(res.ok()).toBe(true)` fails in `beforeAll`.

**This breaks every existing harness spec that calls `becomeDienstleister` + `createTeam`**
(zuschlaege template, team-isolation, shift-model specs, …). It is a pre-existing infra
regression, not caused by any single spec.

**Why:** the guard is correct app behavior (account type fixed after registration); the
test harness assumed a runtime toggle that no longer exists.

**How to apply — write dienstleister-free API specs:**
- A `privat` admin already OWNS a "Standard-Team". Omit `teamId` on every write
  (`POST /api/users`, `/shifts`, `/shift-models`) — `resolveWriteTeamId` falls back to
  the single owned team, and `POST /users` also creates the team membership. Same
  documented pattern as `registerFreeAccount`.
- `GET /api/dashboard/hours-balance` without `teamId` scopes to the owned team; the
  Standard-Team may hold other assistants, so find your row by `userId`, never assert
  `rows.length`.
- `hours-balance` needs premium — the test admin is already premium.
- Directly-created shifts/models have no team-delete cascade; delete them in `afterAll`
  before `h.cleanup()`. `h.cleanup()`'s accountType restore is a privat→privat no-op
  (same value passes the guard).

**Proper infra fix (follow-up, not test-only):** promote the test admin to dienstleister
out-of-band in `scripts/src/setup-test-db.ts` (raw SQL, exactly like the premium UPDATE),
or add a `set-account-type` script mirroring `set-plan`, to unblock the whole harness.
