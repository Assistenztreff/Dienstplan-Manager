---
name: E2E dev auto-login
description: Why Playwright login helpers can hang on the dienstplan login form in dev
---
In dev mode the dienstplan web app, when `/api/auth/me` returns 401, automatically
POSTs `/api/auth/dev-login` and signs in as the seed admin (admin@dienstplan.local).
The AuthProvider then redirects away from `/login`, so the login form (`#email`)
never renders and a naive `page.locator("#email").fill()` waits the full timeout.

**Why:** convenience auto-login for local dev; it is gated on `import.meta.env.DEV`,
which is true under the Vite dev server the E2E suite runs against.

**How to apply:** a UI login helper must treat the form as optional — wait for
`#email` with a short timeout and, if it never appears, assume the auto-login
already authenticated and just assert the post-login URL. Tests can otherwise
navigate straight to an admin route and rely on the auto-login.
