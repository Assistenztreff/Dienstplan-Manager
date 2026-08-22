---
name: Batch endpoints should resolve shared per-scope settings once
description: Pattern for replacing N per-row API calls with one batch endpoint without duplicating expensive per-scope setup work.
---

## Rule
When collapsing an N+1 client-side call pattern (one GET per row, e.g. one vacation-balance fetch per contract in a list) into a single batch endpoint, extract the per-row calculation into a shared function that takes already-resolved scope settings as a parameter, then have the batch route resolve those scope-level settings (e.g. `resolveAllowanceOps` per team) ONCE per distinct scope key and reuse the result across all rows in that scope — not once per row.

**Why:** The per-row settings resolution (team allowance config, plan/ops lookups) is usually the expensive part; naively looping "resolve settings, then compute" per row just moves the N+1 problem server-side instead of eliminating it.

**How to apply:**
- Keep the single-item route (`GET /contracts/:id/vacation-balance`-style) as a thin wrapper calling the same shared function, so both routes stay in lock-step and can't silently diverge.
- The batch route must replicate the SAME authz/scoping rules as the single route (team-scope 404 vs 403 ordering, assistant-self-only restriction) — this is easy to under-scope since it's new code sitting next to already-hardened single-item logic.
- Cache the resolved per-scope settings in a `Map` keyed by the scope id (e.g. teamId) while looping rows.
