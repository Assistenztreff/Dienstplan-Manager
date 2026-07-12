---
name: Stale generated API client on main
description: openapi.yaml can drift ahead of the committed Orval output, turning typecheck red for unrelated tasks.
---

The generated client/zod output (lib/api-client-react/src/generated, lib/api-zod/src/generated) is committed, so an openapi.yaml change can land WITHOUT its regenerated output. Result: `pnpm run typecheck` fails in frontend pages using the new params/fields (e.g. missing query params on a generated *Params type) even for tasks that never touched that area.

**Why:** merges only carry committed files; if a task edited openapi.yaml but not the regenerated dirs, main is silently inconsistent.

**How to apply:** when typecheck fails on generated types you didn't touch, run `pnpm --filter @workspace/api-spec run codegen` first and commit the diff — don't debug the page code.
