---
name: E2E DB fixtures in-process, not via script spawns
description: Why e2e helpers must run their SQL in-process instead of execSync-ing pnpm scripts, and the constraints that apply.
---

**Rule:** E2E helper operations that boil down to 1–2 SQL statements (set plan, add membership, delete account tree, seed admin) must run in-process via `pg` (`artifacts/dienstplan/e2e/helpers/db.ts`), never via `execSync("pnpm --filter @workspace/scripts run <script>")`.

**Why:** each pnpm+tsx spawn costs ~3.2s of pure process overhead; with 100+ helper calls per suite run this added ~5–8 minutes of wall clock. Replacing the spawns cut the full 305-test run to ~14 min test phase, still 303 passed / 2 skipped.

**How to apply:**
- Shared deletion logic (`deleteAccountTrees`, `TEAM_BOUND_TABLES`) lives in `@workspace/test-fixtures` (`lib/test-fixtures/src/account-tree.ts`) with a structural client type so the lib needs no `pg` dependency; both the scripts package and the e2e helpers import it from there. Leaf packages must not import each other.
- DB targeting stays `E2E_TEST_DATABASE_URL ?? DATABASE_URL` — same semantics the spawn path had.
- Use a short-lived `pg.Client` per call, no long-lived pool: Playwright workers can exit anytime and open pool handles delay process exit.
- The e2e folder is NOT covered by the artifact's tsconfig (`include: src/**/*`), so turning a sync helper async will NOT be caught by `pnpm run typecheck` — missing `await`s become silent floating promises. Verify with an ad-hoc `tsc -p` config that includes `e2e/**/*` (extends the artifact tsconfig, noEmit, incremental off).
- One-off spawns that run once per suite (global-teardown cleanups, config-load checks) are not worth converting.
