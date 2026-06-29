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

**Second invariant (member-of-team on write):** It is not enough to check that the
*requester* may write to team_id; the row's `userId` must itself be a member of
that team (`isUserMemberOfTeam(userId, teamId)`), else an admin can link a foreign
user into an allowed team and read their PII back via the user-joined list/by-id
responses (cross-team leak). Enforce on every create that carries a userId:
shifts, contracts, time_tracking. PATCH bodies ContractUpdate/TimeEntryUpdate
deliberately omit userId, so updates can't re-link. **Exception: ShiftUpdate now
accepts an optional userId** (assistant swap for bulk-editing existing shifts).
The shifts PATCH handler must therefore re-apply the SAME member-of-team check
(`isUserMemberOfTeam(body.userId, oldShift.teamId)` → 403; team stays put) and run
the overlap + duplicate-absence checks against the NEW effectiveUserId
(`body.userId ?? oldShift.userId`), not the stored one — otherwise an assistant
swap is validated against the wrong person.
**Why legacy breaks:** users created via POST /users *between* the first
multi-team migration and membership-on-create have domain rows in a team without a
team_members entry — the new write check would 403 their future rows. The
migrate-teams script backfills team_members from existing (user_id, team_id) pairs
in shifts/contracts/time_tracking to heal this; keep that backfill idempotent.
