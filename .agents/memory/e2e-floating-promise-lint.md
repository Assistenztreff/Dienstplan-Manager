---
name: E2E floating-promise lint
description: Type-aware eslint over e2e specs catches missing awaits that tsc cannot
---

The e2e typecheck (tsconfig.e2e.json) cannot catch a missing `await` when a Promise result is discarded (e.g. `expect(locator).toBeVisible()` without await, or fire-and-forget async DB cleanup helpers). Those specs pass silently while asserting nothing.

**Rule:** `lint:e2e` in the dienstplan package runs eslint with `@typescript-eslint/no-floating-promises` + `playwright/missing-playwright-await` (type-aware via tsconfig.e2e.json). It is chained into the package `typecheck` script, so root `pnpm run typecheck` and the merge validation run it automatically.

**Why:** two real latent bugs were found on first run — unawaited async `deleteAccountByEmail` cleanup calls in afterAll hooks.

**How to apply:** new e2e specs must await all Playwright assertions and async helpers; if a promise is intentionally fire-and-forget, mark it with `void`. Config lives in `artifacts/dienstplan/eslint.config.e2e.mjs`.
