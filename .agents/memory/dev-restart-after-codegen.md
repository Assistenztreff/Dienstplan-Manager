---
name: Restart dev workflow after codegen / db push
description: Why a new API field silently fails to persist until the running dev server is restarted
---

# Restart the dev workflow after codegen or db push

After changing `lib/api-spec/openapi.yaml` + running codegen, or after `db push`
adds a column, the **already-running** api-server dev workflow keeps serving the
old generated Zod schema and the old Drizzle column set. Symptom: a new request
field is silently stripped by `safeParse` (Zod drops unknown keys) and never
persists — a round-trip test shows the field absent in the response.

**Why:** the dev process loaded the lib modules at startup; regenerating files on
disk does not hot-reload them in the long-running workflow.

**How to apply:** after `pnpm --filter @workspace/api-spec run codegen` and/or
`pnpm --filter @workspace/db run push`, restart the affected workflow
(`artifacts/api-server: API Server`) before smoke-testing the new field.

## Post-merge reconciliation restarts workflows (verified)

Platform workflow reconciliation runs after the post-merge script and restarts
already-running workflows **both on script success and on script failure**
(verified empirically via `runPostMergeSetup()` + PID comparison).

- Success path: the API server is guaranteed to reload fresh Drizzle/Zod state
  after `db push` — no manual restart step needed inside `post-merge.sh`.
- Failure path: the server restarts anyway, so it runs NEW code against a
  possibly STALE dev DB. The post-merge script must fail loudly (it does) so
  the agent knows to repair `db push` before trusting runtime behavior.
