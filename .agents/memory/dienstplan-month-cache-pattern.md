---
name: Dienstplan month-navigation caching pattern
description: How the Dienstplan calendar keeps the view stable and fast across month switches and reference-data reloads.
---

# Month-scoped queries: stable view across navigation

By default, a TanStack Query list hook keyed by month/year (e.g. shifts for
August vs. September) starts a brand-new query with `isLoading: true` on
every key change, even though the page shape is identical — any top-level
gate like `isLoading && <Skeleton/>` then unmounts the whole view on every
month switch, not just on true first load.

**Pattern established in this repo:** for month-scoped list queries,
- pass `placeholderData: keepPreviousData` so `isLoading` only fires once
  (first mount), and the previous month's data stays rendered while the new
  month fetches — pair with a subtle `isFetching`-driven affordance (e.g.
  dimmed opacity) so the transition isn't silently invisible.
- proactively prefetch the adjacent (prev/next) month's query in a `useEffect`
  keyed only on primitives (month, year, team id) — never on a params object
  literal, since those are recreated every render and would re-trigger the
  effect constantly.
- give month-scoped queries a real `staleTime`/`gcTime` (not the TanStack
  default of 0), so paging back to a recently-viewed month renders instantly
  from cache and only revalidates in the background instead of blocking.

**Why:** this is what makes "leaving the previous month visible while the
next loads" and "instant back-navigation" actually work — `keepPreviousData`
alone only helps the *current* transition; the staleTime/prefetch combo is
what makes *revisits* instant.

**How to apply:** reuse the shared stale/gc-time constants and the
adjacent-month prefetch helper in `artifacts/dienstplan/src/lib/shift-cache.ts`
rather than inventing new literals per call site — keeps behavior consistent
across the calendar page, the shift dialog, and the Abwesenheiten page.

# Reference data (users/teams/shift-models/settings): staleTime is safe

These lists change rarely relative to how often components re-render/remount,
so raising their `staleTime` (avoiding a refetch on every remount/tab-focus)
is safe **as long as every create/update/delete mutation for that resource
explicitly calls `queryClient.invalidateQueries` on its list query key** —
`invalidateQueries` forces a refetch on active observers regardless of
`staleTime`, so writes still show up immediately; only the *redundant,
nothing-changed* refetches are what staleTime suppresses. Verify the
invalidation exists before raising staleTime on a resource — if it's missing,
raising staleTime would turn a latent bug into a visible stale-data one.
