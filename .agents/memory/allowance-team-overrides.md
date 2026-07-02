---
name: Allowance team overrides
description: Per-team override rows share the account settings table; fallback chain and display-percent pitfalls.
---

Team overrides for allowance settings live in the SAME `allowance_settings` table: account row = `team_id IS NULL` (partial unique index on owner_id), override row = `team_id` UNIQUE. Fallback chain everywhere: team override → owner account row → defaults.

**Why:** One table keeps the upsert simple (onConflict on team_id) and the evaluation joins cheap (alias join for the override + owner join). But every reader that only expects one row per owner MUST filter `isNull(teamId)` or overrides leak into account reads.

**How to apply:**
- Any new consumer of allowance settings must implement the full chain, not just the owner join (shift metrics in shifts.ts `allowanceContext`, hours-balance in dashboard.ts both do).
- Display values must match applied values: hours-balance row percents are the requester's account values UNLESS a concrete `teamId` filter is given — then the team-resolved percents are returned so PDF/table labels match the math.
- Ownership check (`assertOwnTeam` → 403) runs on GET/PUT/DELETE with teamId; DELETE override without teamId is 400.
