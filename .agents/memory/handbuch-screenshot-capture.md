---
name: Handbuch screenshot regeneration
description: How the real-app screenshots in the mockup-sandbox Handbuch are regenerated
---

The Handbuch mockups embed real app screenshots from `artifacts/mockup-sandbox/src/components/mockups/handbuch/_assets/` (Vite-imported; `_`-prefixed dirs are ignored by the mockup preview plugin).

**How to apply:** Regenerate after UI changes with `pnpm --filter @workspace/dienstplan run screenshots:handbuch` (env-gated capture spec `handbuch-screenshots.capture.spec.ts`; skipped in normal e2e runs without `HANDBUCH_SCREENSHOTS=1`). On shared staging, pre-checks may fail from foreign runs — retry with `E2E_SKIP_SEPARATION_CHECK=1 E2E_SKIP_CLEANUP_CHECK=1`.

**Nutzer-Entscheidung (07.08.2026):** Handbuch-Einträge UND Screenshots werden bewusst erst in der finalen Dienstplan-Version erstellt — keine Handbuch-Arbeit (Texte, neue Kapitel, Screenshot-Pflege) in normalen UI-Tasks. Nur wenn der Merge-Gate (`screenshots:handbuch:check`) bei einer src-Änderung zwingend einen frischen Fingerprint verlangt, einmalig regenerieren; sonst Handbuch-Dateien unangetastet lassen.
**Why:** User-Ansage „Halbbucheinträge und Screenshots sind jetzt noch nicht nötig, diese werden in der finalen Version des Dienstplanes erstellt"; Handbuch-Tasks (z. B. Kapitel-Doku) wurden zeitgleich vom User verworfen.

**Staleness guard:** the screenshot run stamps `_assets/handbuch-screenshots.fingerprint.json` (sha256 over dienstplan `src/` + `public/` + `index.html`); the registered `handbuch-screenshots` validation (`screenshots:handbuch:check`) fails on drift and names the regen command. Any UI change therefore requires a fresh screenshot run before merge.

**Lock contention escape hatch:** when the shared staging `_test` DB's cross-run advisory lock is continuously held by sibling task envs (and detached local runs get reaped), create a private base DB on the same server (e.g. `CREATE DATABASE dienstplan_shots`), run `setup-test-db` and the capture with `APP_DATABASE_URL`+`DATABASE_URL` pointed at it (private `<name>_test` + private lock key, `E2E_SKIP_DB_SETUP=1` for the capture run), then drop both DBs.

**Why:** The seed uses a friendly-named dienstleister account ("Maria Beispiel") instead of the harness helpers because account name/email appear in the shots; the dev-only user switcher is hidden via injected CSS since it doesn't exist in production builds.

**Fingerprint-Scope:** Nicht-Render-Dateien (`*.test.*`, `*.spec.*`, `__tests__/`, `*.d.ts`) sind vom Frische-Hash ausgeschlossen. Achtung: Jede Änderung am Scope selbst verändert den Hash → einmalig `--update` (ohne Screenshot-Regen nötig, solange UI unverändert).
