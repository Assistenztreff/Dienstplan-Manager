---
name: Dev auto-login breaks form-based E2E locally
description: Why Playwright loginAsAdmin helpers time out at #email in the dev environment
---
In Vite dev mode (`import.meta.env.DEV`), the auth bootstrap in the dienstplan
AuthProvider calls `POST /api/auth/dev-login` whenever `/api/auth/me` returns 401,
which silently authenticates as the dev admin. The app then redirects away from
`/login`, so the login form (`#email`) never renders.

**Why:** every form-based E2E helper (`loginAsAdmin` → `page.goto('/login')` →
fill `#email`) times out locally against the dev workflow, even on unmodified
specs. It is an environment artifact, NOT a regression in the spec under test.

**How to apply:** to verify a UI flow locally, rely on the dev auto-auth (just
`page.goto('/dienstplan')` and wait for the heading) instead of the form login.
The committed form-based specs are still correct — validation/CI runs against a
production build where dev-login is disabled and the form works.
