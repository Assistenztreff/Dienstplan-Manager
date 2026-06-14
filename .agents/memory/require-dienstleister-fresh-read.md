---
name: requireDienstleister reads account_type fresh
description: Team CRUD gating reads account_type from DB per request, never from the session.
---

The `requireDienstleister` middleware (admin + accountType === 'dienstleister')
reads account_type fresh from the DB on every request, not from the session.

**Why:** A user can switch their own account type at runtime (Einstellungen
toggle). If gating relied on a value cached in the session, the new permission
(or its removal) would not take effect until re-login. session only stores
userId + role.

**How to apply:** Any future per-request capability that can change mid-session
should be read from the DB in middleware, not cached in the session. After a
client-side account-type change, call the auth context `refreshUser()` so the
frontend nav/routes update without a reload.
