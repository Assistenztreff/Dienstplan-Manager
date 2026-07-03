---
name: Session isActive revocation
description: Deactivating a user must cut off access immediately, not just at next login — every auth check path needs a fresh isActive read.
---

Long-lived session cookies (e.g. 7 days) mean a deactivated account stays fully authorized unless every place that trusts the session re-validates against the DB.

**Why:** `isActive` was originally only checked at login time. `requireAuth`/`requireAdmin` trusted `req.session.userId` alone, so a disabled admin or assistant kept full access for up to the cookie lifetime. Invitation/set-password flows had the same gap — a deactivated assistant with a still-valid invite token could reset their password and get a fresh authenticated session.

**How to apply:**
- Any middleware that authorizes a request from session state (`requireAuth`, `requireAdmin`, `requireSuperadmin`, `requireDienstleister`) must do a fresh DB read of `isActive` per request and destroy the session + 401 if inactive — not just check `req.session.*`.
- Watch for routes with their own **inline** session check instead of going through the shared middleware (e.g. `GET /auth/me`) — they silently bypass the fix and need the same isActive check added directly.
- Token-based flows (invite tokens, password-reset tokens) must independently check the target/token owner's `isActive` — token validity alone is not enough once revocation is a hard requirement.
- Also check role-scoped IDOR: a token/id-based action must verify the actor's tenant/team relationship to the target user before touching the target, not just that the token or id "matches something" — otherwise cross-tenant enumeration/takeover is possible via user-controlled ids in invite/token endpoints.
