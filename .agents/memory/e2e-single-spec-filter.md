---
name: Running a single e2e spec
description: Why `pnpm run test:e2e -- <file>` runs the whole suite, and how to run one spec.
---

`pnpm --filter @workspace/dienstplan run test:e2e -- <file>` does NOT filter to one spec.
The npm script is `setup-test-db && playwright test -- <file>`; the extra `--` disables
Playwright's positional file-filter, so all specs run (147+), which blows past any bash timeout
and orphans the webServer on ports 8099/5199 (later runs then fail with "port already in use").

**How to apply:** run one spec directly from the artifact dir, no `--`:
`cd artifacts/dienstplan && pnpm exec playwright test <spec-name-substring>`.
setup-test-db only needs to run once per session (it's idempotent); the playwright config's
webServer boots its own isolated stack + `<db>_test` DB and provides E2E_TEST_DATABASE_URL
(needed by setAccountPlan/seedForeignAdmin). If ports are stuck, kill the specific PIDs and
`fuser -k 8099/tcp 5199/tcp` — broad `pkill -f playwright` tends to also SIGKILL the caller shell.
