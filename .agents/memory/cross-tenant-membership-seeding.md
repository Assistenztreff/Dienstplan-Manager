---
name: Cross-tenant team membership seeding
description: Members API rejects cross-tenant adds; e2e specs needing a foreign membership must seed the row via DB script.
---

POST /api/teams/:id/members only accepts users who are already members of a team of the SAME owner (anti-annexation guard, 404 otherwise). A cross-tenant membership can therefore no longer be created via API at all.

**Why:** Without the guard, any platform user id could be enumerated and annexed into one's own team, leaking that user's data through the team-scoping helpers.

**How to apply:** E2E specs that test the edge case "admin is member of a FOREIGN team" (a legitimate historical/DB-side state the read routes must still handle) must insert the `team_members` row DB-directly via the `add-team-member` script (`scripts/src/add-team-member.ts`), wrapped as `addTeamMemberViaDb()` in the dienstplan e2e team helpers. Also: specs that stay red for a while accumulate assertion drift — e.g. vacation accounting moved to hours-based (`vacationHoursUsed`, days = hours/8) while the duplicate-absence spec was red, so its raw `vacationDaysUsed` assertion silently became unsatisfiable. When restoring long-red specs, re-check each assertion against current product rules before debugging the app.
