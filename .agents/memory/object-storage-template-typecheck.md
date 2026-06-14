---
name: Object storage template typecheck fix
description: The copied object-storage server template fails strict typecheck out of the box; one cast is needed.
---

The `objectStorage.ts` file copied from the object-storage skill template calls
`await response.json()` for the Replit sidecar `signed-object-url` response and
destructures `signed_url` from it. Under this repo's strict TS config that is
`unknown`, so `tsc` fails with TS2339 ("Property 'signed_url' does not exist on
type 'unknown'").

**Fix:** cast the parsed JSON, e.g. `(await response.json()) as { signed_url: string }`.

**Why:** the skill says don't modify the GCS client setup, but this is a pure
type annotation, not a logic change, and is required for `pnpm run typecheck`
to pass after copying the template.

**How to apply:** whenever you copy the object-storage server template into an
artifact in this monorepo, add this cast before running the full typecheck.
