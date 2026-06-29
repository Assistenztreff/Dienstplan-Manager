---
name: Dev auto-login breaks form-based E2E locally
description: In Vite dev the dienstplan web app auto-authenticates as admin, so the #email login form never renders and Playwright form-login helpers time out.
---
In Vite dev mode (`import.meta.env.DEV`, which is how the workflow runs the dev
server), the dienstplan `AuthProvider` bootstrap calls `/api/auth/me`; on a 401 it
POSTs `/api/auth/dev-login` and silently signs in as the seed admin
(`ADMIN_EMAIL` / `admin@dienstplan.local`). The app then redirects away from
`/login`, so the login form (`#email`) never renders.

**Why:** any form-based E2E helper (`loginAsAdmin`/`loginViaUi` → `goto('/login')`
→ wait for `#email` → fill) times out locally on `waiting for locator('#email')`,
even on unmodified specs. It is an environment artifact, NOT a regression in the
spec under test. Discovered while adding logo-upload E2E.

**How to apply:** to verify a UI flow locally, rely on the dev auto-auth — just
`page.goto('/dienstplan')` (or the target admin route) and wait for the heading,
instead of the form login. If you keep a form-login helper, treat the form as
optional: wait for `#email` with a short timeout and, if it never appears, assume
auto-login already authenticated and assert the post-login URL. The committed
form-based specs are still correct — validation/CI runs against a production build
where dev-login is disabled and the form works.

**Best workaround for new specs (works in BOTH dev and prod build):** authenticate
programmatically in the browser context — `await page.request.post('/api/auth/login',
{ data: { email, password } })` then `page.goto(targetRoute)`. `page.request` shares
the cookie jar with the page, so the `AuthProvider` bootstrap's `/api/auth/me` returns
200 and renders the target route with NO dependency on the login form or on dev
auto-login. This also lets you control the logged-in account's `accountType` (switch
via API first, e.g. `becomeDienstleister`) so gated routes like `/team-verwaltung`
render. Used by `dienstplan-server-error-messages.spec.ts`.
