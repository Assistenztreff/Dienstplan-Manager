---
name: AuthUser serialization fan-out & role enum widening
description: Gotchas when adding a required AuthUser field or widening the role enum in the Dienstplan api-server.
---

# AuthUser serialization is duplicated inline

The api-server serializes the auth user **inline at many independent call sites** in `routes/auth.ts`
(login, register, `/auth/me`, `/auth/set-password`, and `/auth/dev-login` which has TWO branches:
the default-admin branch AND the optional switched-user branch). There is no single `toAuthUser`
helper for the inline JSON responses — `USER_SELECT` only covers the `db.select(...)`-based paths.

**Rule:** any new *required* AuthUser field (e.g. `plan`) must be added to **every** inline response,
including the easily-missed `/auth/dev-login` switched-user branch. A typecheck pass does NOT catch a
missing field here (the responses are plain object literals, not typed against the OpenAPI schema), so
the contract silently drifts. Verify with curl against each endpoint.

**Why:** the OpenAPI `AuthUser` is the contract but response bodies aren't validated against it at
runtime; only the frontend hand-rolled `AuthUser` type + `readStoredSession` guard depend on the shape.

# Widening the `role` pgEnum

Adding a value to `roleEnum` (e.g. `superadmin`) also requires updating the `express-session`
`SessionData.role` union in `artifacts/api-server/src/middleware/auth.ts` (`declare module
"express-session"`), or every `req.session.role = user.role` assignment fails TS2322.

**Stale tsbuildinfo:** after fixing the augmentation, leaf-package incremental typecheck can keep
reporting the old error. Delete `artifacts/api-server/**/*.tsbuildinfo` and re-run if the error
persists despite a correct fix.
