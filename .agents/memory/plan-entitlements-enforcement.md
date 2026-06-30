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

## Gotcha: registration seeds 4 shift models but Free maxShiftModels = 3

A freshly registered Free account already has 4 seeded default shift models
(Frühdienst/Spätdienst/24h/Bereitschaft), i.e. it STARTS over the limit of 3.
This is intentional Bestandsschutz: the 4 seeded models stay editable/deletable,
but creating a 5th is blocked (403 plan_limit_reached). So when testing the
maxShiftModels gate, a free account blocks immediately on the next POST — you do
NOT need to first create 3 models. If the product ever wants Free users to be able
to add a model, either lower the seed count or raise the limit; don't special-case
the seeded ones.

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
