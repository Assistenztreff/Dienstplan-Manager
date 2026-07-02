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

**How to apply:** the dienstplan E2E suite centralizes this in the shared
`loginViaUi(page, email, password)` helper (`e2e/helpers/auth.ts`): it waits for
`#email` with a short timeout and, if the form never renders (dev auto-login
already authenticated), skips filling and just asserts the post-login URL. All
per-spec `loginAsAdmin(page)` wrappers now delegate to it instead of filling the
form directly — so new specs must NOT reintroduce a raw `goto('/login')` + fill;
reuse the helper. Validation/CI runs against a production build where dev-login is
disabled and the form path is exercised.

**Alternative workaround for new specs (works in BOTH dev and prod build):** authenticate
programmatically in the browser context — `await page.request.post('/api/auth/login',
{ data: { email, password } })` then `page.goto(targetRoute)`. `page.request` shares
the cookie jar with the page, so the `AuthProvider` bootstrap's `/api/auth/me` returns
200 and renders the target route with NO dependency on the login form or on dev
auto-login. This also lets you control the logged-in account's `accountType` (switch
via API first, e.g. `becomeDienstleister`) so gated routes like `/team-verwaltung`
render. Used by `dienstplan-server-error-messages.spec.ts`.

**Variant for fresh registered accounts:** when a spec already holds an authenticated
`APIRequestContext` (e.g. from `registerFreeAccount`), reuse its session in the browser
via `browser.newContext({ storageState: await ctx.storageState() })` — same effect
(`/api/auth/me` returns 200, no dev auto-login), and the browser acts as exactly that
account instead of the seed admin. Used by `dienstplan-uncounted-pending-notice.spec.ts`.
