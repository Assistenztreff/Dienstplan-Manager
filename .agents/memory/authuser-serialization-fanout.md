---
name: AuthUser serialization fan-out & role enum widening
description: Gotchas when adding a required AuthUser field or widening the role enum in the Dienstplan api-server.
---

# AuthUser serialization is duplicated inline

The api-server serializes the auth user at several call sites in `routes/auth.ts`. Since the
"disappearing Auswerten nav item" fix, **every session-establishing response** (login, set-password,
verify-email, both dev-login branches) goes through the shared `fullAuthProfile(user)` helper, which
returns the base fields PLUS `isTeamleiter`/`canViewPayroll`/`teamAccessLevel` — same shape as
`/auth/me`. Only `register` responds inline (fresh accounts trivially have no team grants).

**Rule:** any new AuthUser field must be added to `fullAuthProfile` (and `/auth/me` + register if
required). A session-establishing response WITHOUT the visibility flags reintroduces the bug where
the frontend applies the incomplete profile via `applyUser`, hides Teamleiter/Stufe-1 nav items
(Auswerten, Team-Verwaltung), and even persists the incomplete profile into the localStorage
snapshot — the flicker then survives reloads until `/auth/me` runs. Typecheck does NOT catch a
missing field here (plain object literals, not validated against the OpenAPI schema). Verify with
curl against each endpoint.

**Why:** the OpenAPI `AuthUser` is the contract but response bodies aren't validated against it at
runtime; only the frontend hand-rolled `AuthUser` type + `readStoredSession` guard depend on the shape.

# Widening the `role` pgEnum

Adding a value to `roleEnum` (e.g. `superadmin`) also requires updating the `express-session`
`SessionData.role` union in `artifacts/api-server/src/middleware/auth.ts` (`declare module
"express-session"`), or every `req.session.role = user.role` assignment fails TS2322.

**Stale tsbuildinfo:** after fixing the augmentation, leaf-package incremental typecheck can keep
reporting the old error. Delete `artifacts/api-server/**/*.tsbuildinfo` and re-run if the error
persists despite a correct fix.
