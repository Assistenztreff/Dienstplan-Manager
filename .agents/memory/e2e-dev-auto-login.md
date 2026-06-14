---
name: E2E dev auto-login
description: In dev mode the dienstplan web app auto-authenticates as admin, so #email login form never appears in Playwright.
---
In dev mode the dienstplan web app, when `/api/auth/me` returns 401, automatically
POSTs `/api/auth/dev-login` and signs in as the seed admin (admin@dienstplan.local).
The AuthProvider then redirects away from `/login`, so the login form (`#email`)
never renders and a naive `page.locator("#email").fill()` waits the full timeout.

The dienstplan web app's `AuthProvider` bootstrap calls `/api/auth/me`; on 401 and when `import.meta.env.DEV`, it POSTs `/api/auth/dev-login`, which logs in as the default admin (`ADMIN_EMAIL` / `admin@dienstplan.local`). The vite dev server (how the workflow runs) has `DEV=true`.

**Consequence:** a Playwright helper that does `goto("/login")` then waits for `#email` will time out — the app is already authenticated, so `/login` immediately redirects to `/` and the form never renders.

**How to apply:** a UI login helper must treat the form as optional — wait for
`#email` with a short timeout and, if it never appears, assume the auto-login
already authenticated and just assert the post-login URL. Tests can otherwise
navigate straight to an admin route and rely on the auto-login. For E2E tests against the dev server, just `goto()` the target page directly; the app is already logged in as admin. Keep a form-login fallback (fill `#email`/`#password`, click "Anmelden") only for non-dev/prod builds, guarded by checking whether the email field is actually visible.

**Why:** discovered while adding the logo-upload E2E test; the inherited `loginViaUi` template helper hung for the full test timeout on `waiting for locator('#email')`.
