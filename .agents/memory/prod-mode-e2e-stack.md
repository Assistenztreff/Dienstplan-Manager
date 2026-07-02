---
name: Prod-mode e2e stack
description: How to e2e-test the app in real production mode (NODE_ENV=production API + vite preview) despite Secure cookies and dev-only guards.
---

# Booting a real production stack inside a Playwright spec

The managed e2e stack runs the API with `NODE_ENV=development` and Vite dev — it can never verify production-only behavior (route guards behind `NODE_ENV !== "production"`, `import.meta.env.DEV` UI removal, no auto dev-login).

Pattern (see `artifacts/dienstplan/e2e/dienstplan-prod-dev-switcher-hidden.spec.ts`):
- Build the api-server bundle, then spawn `node dist/index.mjs` with `NODE_ENV=production` on a spare port (8097) against the isolated `_test` DB (`E2E_TEST_DATABASE_URL`, else derive `_test` suffix from `DATABASE_URL`). NODE_ENV is a runtime decision — nothing is baked into the esbuild bundle.
- `vite build` (needs `PORT` + `BASE_PATH` env or the config throws), then serve via `vite preview` (`run serve`) on another spare port (5197) with `E2E_API_PROXY_TARGET`.

**Why the preview proxy sends `X-Forwarded-Proto: https`:** in production the session cookie is `Secure; SameSite=None`. Express-session refuses to set a Secure cookie over plain HTTP unless `trust proxy` sees a forwarded-https header (trust proxy=1 is already set). Chromium accepts Secure cookies on localhost, so browser login then works end-to-end.

**How to apply:** any future "prove X is disabled/enabled only in production" check should reuse this spec's harness instead of asserting on bundle strings (guarded-but-imported components may legitimately keep their strings in the prod bundle; only runtime rendering matters).

Gotchas:
- Raise the beforeAll hook timeout via `test.setTimeout(...)` inside the hook (builds take ~1 min).
- Spawn children with `detached: true` and kill the process group (`process.kill(-pid)`) — pnpm wrappers otherwise orphan vite.
- Default e2e viewport is 400px; md-only UI absence checks need an explicit desktop viewport or they pass trivially.
