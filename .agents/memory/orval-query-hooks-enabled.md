---
name: Orval query hooks enabled cast
description: How to pass query options like `enabled` to generated React Query hooks without breaking data typing.
---

# Passing `enabled` (and other query options) to generated hooks

The Orval-generated query hooks type their second arg as `{ query?: UseQueryOptions<...> }`. In the current @tanstack/react-query version `UseQueryOptions` requires `queryKey`, so passing `{ query: { enabled: x } }` fails: "Property 'queryKey' is missing".

**Established pattern in this repo (mobile):** cast the options arg to `Parameters<typeof useXyz>[1]`.

**Gotcha:** that cast collapses the inferred `TData` to `{}`, so the returned `data` loses its type and `.map/.find/.length` error. You must ALSO cast the result, e.g. `const rows = (rawData ?? []) as Xyz[];`.

**Why:** casting the (generic) second parameter resolves the function's generics with defaults/unknown, degrading the return inference.

**How to apply:** when adding `enabled`/other query options to a generated hook, do both casts together — options cast for the call, result cast for the data. The web app (dienstplan) mostly calls these hooks with no options, so it doesn't hit this.
