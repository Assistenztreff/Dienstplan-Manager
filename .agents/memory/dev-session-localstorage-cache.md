---
name: Dev session localStorage cache
description: How/why the web auth context caches a dev session in localStorage, and the guard + what must never be stored.
---

# Dev session localStorage cache (web)

The web auth context caches the logged-in **user profile** (id/name/email/role/accountType) in
`localStorage` under key `assistenz_treff_session` to hydrate UI instantly on reload and avoid the
auth flash. The real authentication remains the server-side httpOnly session cookie (`connect.sid`);
the cache is only an optimistic UI hint and is always reconciled by the `/api/auth/me` →
`/api/auth/dev-login` bootstrap.

**Rules:**
- Store ONLY the non-sensitive profile. NEVER store passwords, tokens, or session secrets — that
  would be an XSS credential-theft vector.
- Guard every read/write with `import.meta.env.DEV`, NOT `process.env.NODE_ENV`. In the Vite browser
  bundle `process` is undefined; `import.meta.env.DEV` is statically replaced and the dead branch is
  stripped from production builds, so the cache/bypass cannot exist in prod.
- Keep the cache in sync in every auth-state setter (bootstrap, login, logout, setPassword,
  refreshUser); logout must clear the key.

**Why:** user wanted persistent dev auto-login so task-switching/reload doesn't force re-login. The
secure pattern is to keep auth on the server cookie and only cache the display profile client-side.

**How to apply:** when touching `artifacts/dienstplan/src/context/auth.tsx`, preserve the
`storeSession`/`readStoredSession` helpers and the DEV guard; don't promote the cache to the source
of truth for auth.
