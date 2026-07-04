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
- `maxAssistants` → POST /users when `role === "assistant"`, enforced in ONE
  block after `resolveWriteTeamId` (once the target team is known): count distinct
  assistants across ALL teams of the target team's OWNER and check the OWNER's plan
  (account-wide). An earlier duplicate pre-block that counted against the requester
  was removed — it could wrongly block a Premium member-admin in a Free owner's
  team (and vice versa).
- `maxTeams` → POST /teams (count teams owned by the user; registration already
  seeds 1 Standard-Team so a Free dienstleister starts at the limit).
- `historyMonths` → POST /shifts AND PATCH /shifts/:id (forward-planning cap, see
  move-forward section below). Compared in whole calendar months: a shift is blocked
  when its start month is more than `historyMonths` months ahead of the current
  month. Free (1) = current + next month. PAST months are never blocked (backfill /
  Bestandsschutz); PATCH only re-checks when `startTime` is in the body, so
  notes/type edits on existing shifts stay free. Single owner-based helper
  (`forwardPlanningBlocked`) is the one source for both paths.
ALL feature flags now have authoritative server enforcement (see below) —
`payrollExport` only transitively via hours-balance, plus frontend UX gates.

**"No API exists" claims must be grepped, not trusted:** `absenceTracking`
(Resturlaub balance) was long documented as frontend-only "because no balance
endpoint exists" — but a spec-generated `GET /contracts/:id/vacation-balance`
endpoint DID exist (unused by the frontend, which computes the balance
client-side) and sat ungated until it got `requirePlanFeature`. Lesson: before
declaring a feature frontend-only, grep openapi.yaml/routes for forgotten
endpoints — contract-first codegen can produce reachable API surface no client
uses. Creating absences (vacation/sick) stays FREE on all plans; only the
tracked balance is premium, and the raw inputs (contracts, vacation shifts)
remain free-accessible (Bestandsschutz).

## Gotcha: registration seeds 5 shift models, Free maxShiftModels = 5 (AT limit)

A freshly registered Free account already has 5 seeded default shift models
(Frühdienst/Spätdienst/Nachtdienst/Bereitschaft/24h Dienst). The limit
deliberately EQUALS the seed count: a fresh Free account starts exactly AT the
limit — the 6th POST is blocked immediately; an own model is only possible after
deleting a seeded model or upgrading. This is a conscious product decision, not a bug. Seeded models
stay editable/deletable (Bestandsschutz); only creating over the limit is
blocked. If the product wants Free users to add more, raise the limit — don't
special-case the seeded ones. Absences (Urlaub/Krankheit) are NOT shift models
and stay available for Free.

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

## Not every feature flag maps to an enforceable endpoint

The entitlement config lists more feature flags than the app has endpoints for.
Only gate a flag where a real server action/endpoint exists; gating a flag that
has no endpoint either does nothing or breaks a core flow:
- `advancedPersonnelFile` = WRITING the wage/SV fields on `users` (birthDate,
  socialSecurityNumber, taxId, taxClass, healthInsurance, iban) on POST/PATCH
  /users. Reading those fields is never blocked (Bestandsschutz); PATCH compares
  the new value against the stored value and only blocks a real change, so a form
  that re-sends unchanged existing values still saves.
- `advancedAnalytics` = GET /dashboard/hours-balance (the Soll/Ist computation).
  It's also the data source for the client-side payroll/Stundennachweis PDF, so
  gating it transitively enforces `payrollExport` — there is NO separate export
  endpoint. The raw shifts/time-entries/contracts stay visible via their own list
  endpoints, and GET /dashboard/summary (basic KPIs) stays free.
- `caregiverLogin` = generating NEW invite tokens (POST /users/:id/invite), NOT
  login itself — gating login would lock out already-invited assistants of Free
  teams (Bestandsschutz). Existing logins keep working on Free.
- `strictTimeTracking` = the confirm/reject workflow (PATCH /time-tracking/:id/
  confirm). Recording time entries stays free (core flow). Because Free entries
  stay "offen" forever, dashboard/summary counts Ist-Stunden PLAN-AWARE: confirmed
  always; pending additionally in teams whose OWNER lacks strictTimeTracking
  (helper `getLenientTimeTrackingTeamIds` in api-server lib/plan.ts, applied in
  both the admin and assistant branch); rejected never. Premium-owned teams stay
  strict (confirmed only). Read-time rule only — no entry statuses are mutated,
  so an upgrade/downgrade flips the counting instantly. General lesson: when a
  premium gate blocks a WORKFLOW step, downstream aggregations must not silently
  assume that step happens — count the pre-step state for plans without the gate.
- `calendarSync` = a purpose-built GET /calendar-export endpoint (ICS of FIX
  shifts; assistants own, admins team-scoped). When no endpoint exists for a
  flag, build a minimal real one rather than gating an unrelated core route.

**Read vs write under Bestandsschutz:** for "data" features (personnel file), gate
WRITES and keep reads open. For derived/computed premium views (analytics), gating
the whole read is OK because no stored data is hidden — the raw inputs remain
reachable elsewhere.

## bulkEdit gate is the userId-reassignment on PATCH /shifts

The only server capability unique to Massenbearbeitung is the assistant swap
(`ShiftUpdate.userId` on PATCH /shifts) — the single-shift edit dialog never sends
userId. That reassignment is gated behind the premium `bulkEdit` feature; ordinary
single-shift edits (times/notes/type) stay free.
