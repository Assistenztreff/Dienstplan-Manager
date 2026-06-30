---
name: Plan entitlements enforcement
description: How Free/Premium plan limits are enforced server-side and the seeding-vs-limit tension to watch for.
---

# Free/Premium entitlement enforcement

The plan config (PLAN_CONFIG, hasAccess/getLimit/isWithinLimit) lives in the shared
`@workspace/entitlements` lib and is imported by BOTH the web frontend and the
api-server. Frontend gates are UX only; the api-server enforces authoritatively
using the same config.

**Why shared:** keeping one config in the frontend let the limits drift / be
bypassed via direct API calls. Any new plan rule must go in the shared lib so both
sides stay in lockstep.

**How to apply:**
- Server enforcement helpers read `users.plan` FRESH from the DB per request
  (not from the session) — same reasoning as `requireDienstleister`, so a manual
  premium unlock takes effect immediately.
- Limits gate only NEW creation (Bestandsschutz). `isWithinLimit(user, limit,
  currentCount)` answers "is one MORE allowed", never an display filter. Never
  hide/lock/delete existing rows because an account is Free.

## Which limits are enforced server-side, and where

All four numeric limits + the `bulkEdit` feature are now enforced authoritatively
(403 `plan_limit_reached` with a `limit` field, or `plan_feature_required`):
- `maxShiftModels` → POST /shift-models (count per target team).
- `maxAssistants` → POST /users when `role === "assistant"` (count distinct
  assistant users across the creator's allowed teams; Free has 1 team).
- `maxTeams` → POST /teams (count teams owned by the user; registration already
  seeds 1 Standard-Team so a Free dienstleister starts at the limit).
- `historyMonths` → POST /shifts only (forward-planning cap). Compared in whole
  calendar months UTC: a shift is blocked when `shiftMonthIdx - currentMonthIdx >
  historyMonths`. Free (1) = current + next month. PAST months are never blocked
  (backfill / Bestandsschutz); PATCH /shifts is intentionally NOT gated so
  existing shifts stay editable.
The remaining feature flags (advancedPersonnelFile, payrollExport, etc.) are still
config-only (frontend UX), not server-enforced.

## Gotcha: registration seeds 4 shift models, Free maxShiftModels = 5

A freshly registered Free account already has 4 seeded default shift models
(Frühdienst/Spätdienst/24h/Bereitschaft). The limit is deliberately 5 (= 4 seeds
+ 1 own model) so a new Free account can still add exactly one own model before
being blocked on the 6th. The limit MUST stay above the seed count. Seeded models
stay editable/deletable (Bestandsschutz); only creating over the limit is blocked.
If the product wants Free users to add more, raise the limit — don't special-case
the seeded ones.

## Gotcha: registration seeds a Standard-Team but Free maxTeams = 1

Same seeding-vs-limit pattern as shift models: registration creates one initial
"Standard-Team" (owner = new user), so a fresh Free Dienstleister account already
sits AT maxTeams = 1. POST /api/teams counts owned teams and blocks the SECOND
team with 403 plan_limit_reached (limit maxTeams). Bestandsschutz: the seeded team
(and any pre-existing teams) stay; only creating one MORE over the limit is blocked.
So testing the maxTeams gate needs no setup — the next POST blocks immediately.

## A create-time limit must also be enforced on edit (move-forward bypass)

`historyMonths` (Free forward-planning window) is enforced on POST /shifts AND on
PATCH /shifts/:id — otherwise a Free account creates an allowed shift and PATCHes
its startTime far into the future, bypassing the create gate. General rule: any
limit keyed on a mutable field (date, target team, owner) must be re-checked on
every mutation path that can change that field, not just on create. PATCH only
re-checks when the gated field is actually in the body (Bestandsschutz: notes/
type edits on existing rows stay free).

**Whose plan counts:** shift forward-planning + maxAssistants base the limit on
the TEAM OWNER's plan, not the requester — a member-admin (possibly premium) must
not be able to exceed a foreign Free team's limit via their own plan.

## bulkEdit gate is the userId-reassignment on PATCH /shifts

The only server capability unique to Massenbearbeitung is the assistant swap
(`ShiftUpdate.userId` on PATCH /shifts) — the single-shift edit dialog never sends
userId. That reassignment is gated behind the premium `bulkEdit` feature; ordinary
single-shift edits (times/notes/type) stay free.
