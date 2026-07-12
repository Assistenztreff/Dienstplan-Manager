---
name: Merge validation runs API-only e2e subset
description: Registered validation steps (typecheck, e2e-api) run on every merge; how the API-spec filter works.
---

Two validation commands are registered via the validation skill and run on every `mark_task_complete`/merge:

- `typecheck` — `pnpm run typecheck`
- `e2e-api` — `pnpm --filter @workspace/dienstplan run test:e2e:api`

**Why:** while 13 specs were red for weeks, two product changes silently invalidated their assertions. Running at least the fast API-only e2e subset on every merge surfaces red specs immediately.

**How to apply:**
- The npm script `test:e2e:api` bakes the file filter into the script (`playwright test "api\.spec\.ts$"`) — passing filters through `pnpm run test:e2e -- <file>` does NOT work (extra `--` kills the filter).
- The filter matches all `*-api.spec.ts` files; name new API-only specs with that suffix so they join the merge gate automatically.
- Full run ≈ 3 min including test-DB provisioning checks; the playwright config self-manages the isolated stack, run lock, and orphan reaping, so a validation run aborts cleanly if a manual e2e run is in progress (and vice versa).
- If a task legitimately leaves an API spec red, fix or adjust the spec in the same task — do not deregister the validation.
