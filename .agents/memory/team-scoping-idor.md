---
name: Team scoping & GET:id IDOR
description: Multi-team data isolation rule — every by-id read for admins must enforce row.teamId ∈ allowedTeams, not just list endpoints.
---

# Team scoping & GET/:id IDOR

When domain tables carry `team_id`, list endpoints are the obvious place to add `inArray(table.teamId, scope)` — but the easy-to-miss leak is the **single-row by-id reads** (`GET /<resource>/:id`). These often only had the older assistant self-access check (`row.userId === session.userId`) and silently let an **admin** read any row across teams by guessing the id.

**Rule:** every by-id read (and PATCH/DELETE) must, for the admin branch, load `row.teamId` and enforce `getAllowedTeamIds(userId).includes(row.teamId)`, returning **404** (not 403) on mismatch — so existence isn't revealed. The assistant branch stays userId-personal.

**Why:** allowed teams = teams owned (`teams.owner_id`) ∪ teams joined (`team_members`). List scoping alone is incomplete; IDOR via by-id endpoints is a real cross-team data leak. Found exactly this gap in `GET /api/shifts/:id` after the list/PATCH/DELETE were already scoped.

**How to apply:** when the select DTO doesn't include `teamId`, add it inline to the select for the check, then destructure it out before `res.json(...)` (same pattern as `time_tracking/:id`). Audit *all* by-id handlers, not just the list ones, whenever adding team/tenant scoping.
