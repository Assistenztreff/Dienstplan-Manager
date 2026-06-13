---
name: One-off scripts importing workspace packages
description: Why code_execution/node can't import @workspace/* and how to run a one-off backfill/migration script.
---

The `code_execution` sandbox (and plain `node`) cannot import `@workspace/db` (or other `@workspace/*` libs) from the repo root: pnpm symlinks workspace packages into each *consumer's* `node_modules`, not the root, and the composite libs are `emitDeclarationOnly` (types only, no runnable JS dist).

**How to apply:** to run a one-off script (backfill, data migration) that needs a workspace lib, create a temp `.ts` inside a consuming artifact (e.g. `artifacts/api-server/src/_tmp.ts`), bundle it with esbuild from that artifact dir (`platform:node, format:esm, bundle:true, external:['pg-native','*.node']`, plus a `createRequire` banner), run the emitted `.mjs` with `node`, then delete both temp files. This reuses the artifact's resolved `node_modules` so workspace imports work.
