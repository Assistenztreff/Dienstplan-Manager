---
name: E2E account SQL cleanup
description: Why registered E2E test accounts must be deleted via SQL helper, not DELETE /api/users
---

Accounts registered via `/api/auth/register` in E2E specs CANNOT be removed via `DELETE /api/users/:id`: registration creates a "Standard-Team", and team-scoped tables (`shift_models`, `shifts`, `contracts`, `time_tracking`, `shift_templates`) reference `teams.id` WITHOUT cascade — the 4 seeded shift models alone FK-block every account delete.

**Rule:** spec cleanup must go through the SQL helper — `deleteFreeAccount(acc)` / `deleteAccountByEmail(email)` in `e2e/helpers/teams.ts`, which shells out to `scripts delete-account` (`DELETE_ACCOUNT_EMAIL=...`) against the `_test` DB via `E2E_TEST_DATABASE_URL`.

**Why:** the old best-effort API `tryDelete` chains silently left users/teams rows behind on every run, so the `_test` DB grew unboundedly.

**How to apply:** any new spec that calls `registerFreeAccount` must call `deleteFreeAccount` in its afterAll/afterEach. The script deletes in FK-safe order (team-bound data → orphaned assistants → teams → user), is idempotent, and refuses non-`@dienstplan.test` emails unless `DELETE_ACCOUNT_ALLOW_ANY=1`.

**Safety net (self-healing):** a batch variant (`scripts cleanup-test-accounts`, shared FK-safe core in `scripts/src/lib/account-tree.ts`) deletes ALL `e2e.%@dienstplan.test` accounts. It runs in Playwright globalTeardown (after every run) AND in `setup-test-db` (before every run — heals leftovers of aborted runs where afterAll never fired). Spec-level cleanup is still required so sibling specs don't see each other's data mid-run. New test emails MUST keep the `e2e.` prefix + `@dienstplan.test` domain or the sweeper won't catch them.
