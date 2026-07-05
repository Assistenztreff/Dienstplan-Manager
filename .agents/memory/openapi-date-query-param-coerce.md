---
name: OpenAPI date query params
description: Why date/time query params must be type:string, not format:date-time, in this repo's Orval/zod codegen.
---

# OpenAPI date query params → coerce, not zod.date()

Declare optional date/time **query** parameters as `type: string` (with a
`maxLength`), NOT `format: date-time`.

**Why:** Orval codegen turns `format: date-time` into a `zod.date()` schema
*without* coerce. Query-string values always arrive as strings, so the route
validation rejects them before the handler runs. Using `type: string` generates
`zod.coerce.string()`, which accepts the raw string; the handler then parses it
itself (e.g. `new Date(v)` with an invalid-date guard → 400).

**How to apply:** For any `in: query` date filter (`from`/`to`, ranges), use
`type: string` + `maxLength`, re-run `pnpm --filter @workspace/api-spec run
codegen`, and do the Date parsing + validation in the handler. Body/response
date fields can still use `format: date-time` (they aren't string-coerced from
the URL).
