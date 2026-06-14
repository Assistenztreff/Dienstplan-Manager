---
name: User-list team scoping requires membership-on-create
description: GET /users is scoped by team membership; creating a user must also assign membership or it vanishes from scoped lists
---

GET /api/users is scoped to the requester's allowed teams (members of teams they own ∪ belong to). Without a `teamId` it returns the union of those teams' members. A foreign `teamId` → 403. The only exception is the privat-admin bootstrap case below — a `dienstleister` NEVER sees a global pool.

**Why:** A global user pool leaks user PII across dienstleister tenants. Scoping by `team_members` is the only principled isolation available (there is no per-user ownership column).

**How to apply:** Any flow that creates a user (POST /users, the assistenten page) MUST also assign team membership, otherwise the new user is in no allowed team and disappears from every scoped list and UI picker (assistant chips, dialogs are sourced from `useListUsers`, not from shifts). POST /users takes an optional `teamId` (membership only, not a users column — strip it before insert) and resolves the target team via `resolveWriteTeamId` (default = creator's resolved team); the frontend passes `selectedTeamId`. Same rule for contract/shift-model creation: pass the selected team's id so the row lands in the active team, not the default.

**Bootstrap exception (privat only):** GET /users falls back to the global pool ONLY when the requester's `accountType === "privat"` AND they have zero allowed teams AND sent no `teamId`. Read accountType fresh from DB (like requireDienstleister). Rationale: a privat admin is a single household, not a tenant — without this, first-setup privat admins get an empty list and can't see themselves or assign anyone. **A `dienstleister` is NEVER given the global pool**, even with zero teams (they get an empty list until they create a team) — that is the tenant-isolation boundary. Once a privat admin has ≥1 team, strict membership scoping resumes. An earlier broad version (any admin with zero teams) was rejected in review as cross-tenant PII exposure.

**Gotcha:** The Shift response DTO does NOT serialize `teamId`, but ShiftModel/Contract DTOs do — derive a known team id from those, not from shifts.
