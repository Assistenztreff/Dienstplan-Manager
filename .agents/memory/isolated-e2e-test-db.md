---
name: Isolated E2E test database & managed stack
description: How Playwright e2e runs against a separate test DB + managed API/Vite stack so dev data is never touched.
---

# Isolated E2E test stack

E2E specs create AND delete real records (assistant-delete, abwesenheiten, shifts…). They must never run against the dev DB.

**Design:** Playwright's `webServer` (in `artifacts/dienstplan/playwright.config.ts`) boots an isolated stack:
- API server on a separate port with `DATABASE_URL = <devdbname>_test`.
- Vite dev server on a separate port whose `/api` is proxied to that test API (gated in `vite.config.ts` by `E2E_API_PROXY_TARGET` — unset in normal dev, so the shared Replit proxy is unaffected).
- `baseURL` and `process.env.E2E_BASE_URL` both point at the test Vite server so the specs' own `BASE_URL` constant and the browser hit the same isolated stack.

**Why the Vite proxy matters:** browser + Playwright request context both talk to the Vite origin; proxying `/api` there keeps cookies same-origin (session login works) and avoids cross-port CORS/cookie issues.

**Provisioning:** `scripts/src/setup-test-db.ts` (`pnpm --filter @workspace/scripts run setup-test-db`) creates `<dbname>_test` if missing (CREATE DATABASE issued from a connection to the *dev* DB — can't create the DB you're connected to), then runs db push + setup-admin + migrate-teams against it with `DATABASE_URL` overridden. Idempotent. `test:e2e` runs it before `playwright test`.

**Override:** set `E2E_BASE_URL` externally → no managed stack is started, tests run against that URL (e.g. shared proxy localhost:80). Only for deliberate manual runs.

**Why:** destructive tests on the shared dev DB churn real data (created/deleted temp users left ID gaps) and risk corrupting real records on an interrupted run.
