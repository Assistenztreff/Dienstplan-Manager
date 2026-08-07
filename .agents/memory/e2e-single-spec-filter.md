---
name: Running a single e2e spec
description: Why `pnpm run test:e2e -- <file>` runs the whole suite, and how to run one spec.
---

`pnpm --filter @workspace/dienstplan run test:e2e -- <file>` does NOT filter to one spec.
Historically the npm script was `setup-test-db && playwright test`, where the extra `--`
disabled Playwright's positional file-filter, so all specs ran (147+), blowing past any bash
timeout and orphaning the webServer on 8099/5199 ("port already in use" on later runs).
The script is now plain `playwright test` (setup moved into the config), but the direct
`pnpm exec` form below remains the reliable way to run one spec.

**How to apply:** run one spec directly from the artifact dir, no `--`:
`cd artifacts/dienstplan && pnpm exec playwright test <spec-name-substring>`.
The substring matches across ALL spec files: `dienstplan-assistant` pulls in 32 tests
from 5 files (assistant-create-duplicate-email, assistant-delete, …) and blows the
5-min shell cap. Anchor exact files: `playwright test "dienstplan-assistant\.spec"`,
and keep batches ≤3 specs per foreground run (3 specs ≈ 2.7 min incl. stack boot).
The playwright config itself runs setup-test-db at load time (managed stack only,
main process only), so single-spec runs auto-provision the `<db>_test` DB; skip via
`E2E_SKIP_DB_SETUP=1` for fast repeat runs without schema changes. The config's
webServer boots its own isolated stack + `<db>_test` DB and provides E2E_TEST_DATABASE_URL
(needed by setAccountPlan/seedForeignAdmin). If ports are stuck, kill the specific PIDs and
`fuser -k 8099/tcp 5199/tcp` — broad `pkill -f playwright` tends to also SIGKILL the caller shell.
