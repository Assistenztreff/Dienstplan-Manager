---
name: superadmin role not settable via normal APIs
description: Which API surfaces can/can't touch users.role, and the empty-update 500 pitfall
---

Betreiber-Rechte (role `superadmin`) can only be granted/revoked by the seed/revoke scripts, never via the app APIs. The reasons are structural, not a single guard:

- **Registration** hardcodes `role: "admin"` and never reads a body `role`.
- **update-profile** only sets `name`/`email`; it ignores any other body field.
- **PATCH /users/:id** validates with `UpdateUserBody`, which has **no `role` field at all** → Zod strips an injected `role` silently, so role is never settable here (even to admin/assistant). The `[admin, assistant]` enum lives on `UserCreate`/`UserUpdate` DTOs, but the PATCH route uses `UpdateUserBody`.
- **Operator plan endpoint** body schema (`UpdateOperatorAccountPlanBody`) is a plain non-strict `zod.object({plan, note})` → unknown keys like `role` are stripped, only `plan` is written.

**Empty-update 500 pitfall:** because `UpdateUserBody` strips unknown keys, a PATCH whose only key is stripped (e.g. `{ role: "superadmin" }`) leaves `body.data = {}`, and Drizzle `.update().set({})` throws → HTTP 500 (not a 400). To assert "role is ignored", send a valid field too (e.g. `name`) so the update isn't empty and returns 200 with role unchanged.

**Why:** the safeguard spec (`dienstplan-superadmin-nicht-ueber-api.spec.ts`) proves none of these surfaces can mint/strip superadmin; the empty-set 500 is an incidental robustness quirk, not a privilege issue.
