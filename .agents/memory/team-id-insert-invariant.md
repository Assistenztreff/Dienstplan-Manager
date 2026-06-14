---
name: team_id NOT NULL insert invariant
description: Every insert into team-scoped tables must supply team_id, including hidden auto-booking inserts.
---

team_id is NOT NULL on shifts, contracts, shift_models, and time_tracking. Any
code path that inserts into these tables must supply team_id or the insert fails
at runtime (and typecheck flags the missing property).

**Why:** Multi-team foundation. The non-obvious trap is that time_tracking gets
inserted from more than one place: the public POST /time-tracking handler AND a
hidden absence auto-booking helper inside the shifts route (triggered when a
vacation/sick shift is created). Both must pass team_id.

**How to apply:** Resolve team_id with `resolveTeamId(userId)` (prefers an owned
team, falls back to first membership) in admin create handlers. For
time-tracking linked to a shift, inherit the shift's team_id instead. When
adding any new insert into a team-scoped table, thread team_id through — grep for
all `.insert(<table>Table)` call sites, not just the obvious route handler.
