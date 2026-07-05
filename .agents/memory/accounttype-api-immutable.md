---
name: accountType no longer API-mutable (harness impact)
description: users PATCH blocks real accountType changes; how to get a dienstleister session in e2e now
---

# accountType is API-immutable — becomeDienstleister() is broken

A merged security change in `artifacts/api-server/src/routes/users.ts` makes the
users PATCH reject any REAL `accountType` change (only the unchanged current value
passes). This is intentional: account type is fixed at registration and must not
be mutable via the API.

**Impact:** the e2e helper `becomeDienstleister()` (which flipped the shared admin
to `dienstleister` via API) now 403s. Any spec that needs a Dienstleister actor
must NOT use it.

**How to apply:** get a Dienstleister session by REGISTERING one:
`registerFreeAccount("dienstleister", "<slug>")` gives a fresh admin/dienstleister
account with its own Standard-Team (TeamSwitcher visible). Upgrade with
`setAccountPlan(email, "premium")` if the scenario needs premium features
(e.g. advancedAnalytics for Auswertungen). Clean up with `deleteFreeAccount(acc)`
in afterAll (SQL cleanup covers all owned teams; allowance rows cascade via
owner_id/team_id).
