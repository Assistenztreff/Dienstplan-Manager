---
name: Discovering team IDs in API e2e tests
description: How a self-registered test account can learn its own Standard-Team ID purely via the API.
---

Shift/contract DTOs deliberately strip `teamId` from responses, and `privat` accounts are blocked from `GET /teams`. So a freshly registered `privat` account has NO API way to learn its own Standard-Team ID.

**How to apply:** For API specs that need a team ID (e.g. to probe `?teamId=` scoping/403s), register the throwaway account as `dienstleister` via `registerFreeAccount("dienstleister", ...)` and read the ID from `GET /teams` (registration always creates exactly one Standard-Team). Backend scoping semantics are identical for both account types.

**Why:** Asserting `shift.teamId` from a POST /shifts response fails — the field is undefined in the DTO by design (no cross-team ID leakage).
