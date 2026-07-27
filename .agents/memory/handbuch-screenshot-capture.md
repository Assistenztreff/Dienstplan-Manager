---
name: Handbuch screenshot regeneration
description: How the real-app screenshots in the mockup-sandbox Handbuch are regenerated
---

The Handbuch mockups embed real app screenshots from `artifacts/mockup-sandbox/src/components/mockups/handbuch/_assets/` (Vite-imported; `_`-prefixed dirs are ignored by the mockup preview plugin).

**How to apply:** Regenerate after UI changes with `pnpm --filter @workspace/dienstplan run screenshots:handbuch` (env-gated capture spec `handbuch-screenshots.capture.spec.ts`; skipped in normal e2e runs without `HANDBUCH_SCREENSHOTS=1`). On shared staging, pre-checks may fail from foreign runs — retry with `E2E_SKIP_SEPARATION_CHECK=1 E2E_SKIP_CLEANUP_CHECK=1`.

**Why:** The seed uses a friendly-named dienstleister account ("Maria Beispiel") instead of the harness helpers because account name/email appear in the shots; the dev-only user switcher is hidden via injected CSS since it doesn't exist in production builds.
