---
name: Features via team-owner plan for assistants
description: Assistant accounts are always free; employee-facing premium features must gate on the team OWNER's plan, and the frontend can't use currentUser.plan as the signal.
---

Assistant accounts are practically always `free` (only admin accounts are paying accounts, unlocked manually). Any premium feature an ASSISTANT should be able to use must therefore gate on the plan of the TEAM OWNER (employer), not the requester/token owner.

**Why:** Gating on the requester's own plan makes the feature permanently unreachable for assistants (e.g. calendar subscription tokens), even though UI and data branches for assistants exist.

**How to apply:**
- Server: `userHasFeatureViaTeamOwner` / `requirePlanFeatureViaTeamOwner` in the api-server plan lib — own plan first, then owner-plan fallback ONLY for role `assistant` (one premium employer among memberships suffices). Public token feeds must use the same helper so an employer downgrade locks the assistant's feed too.
- Frontend: `currentUser.plan` is useless as a gate signal for assistants (always free). Probe an already-gated endpoint instead (e.g. the token GET query: 200 = unlocked, 403 = locked) rather than adding new plan fields.
- Revocation endpoints (DELETE token) stay ungated by design.
