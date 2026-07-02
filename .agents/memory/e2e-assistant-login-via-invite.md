---
name: E2E assistant login via invite flow
description: How to get a logged-in assistant session in e2e specs despite the Premium invite gate
---

Specs that need an ASSISTANT session (assistant-branch APIs, role-gated UI) can't register one
(register creates admins) and can't invite on Free (POST /users/:id/invite is Premium/caregiverLogin).

**Pattern:** register a fresh Free owner → create assistant → `setAccountPlan(owner, "premium")` →
POST invite (response includes `token`) → `setAccountPlan(owner, "free")` → new APIRequestContext →
`POST /auth/set-password {token, password}` — this both sets the password AND logs the session in.

**Why it works:** Bestandsschutz — the invite gate only blocks generating NEW tokens; a token set
while Premium stays valid and set-password has no plan gate. Browser tests reuse the assistant
context's storageState (avoids dev auto-login).

**How to apply:** any spec testing assistant-only behavior end-to-end; see
`artifacts/dienstplan/e2e/dienstplan-assistant-uncounted-pending.spec.ts`.
