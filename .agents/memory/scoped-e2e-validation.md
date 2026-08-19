---
name: Gestaffelte Merge-E2E-Validierung
description: Das e2e-Validierungskommando staffelt die Testkette nach Änderungsart (git-Diff-Kategorien docs/frontend/full).
---

Das registrierte `e2e`-Validierungskommando ist `pnpm --filter @workspace/scripts run scoped-e2e`. Es ermittelt geänderte Dateien (merge-base zu `main-repl/main`/`origin/main` + Arbeitsbaum) und startet nur die betroffenen Blöcke der seriellen Kette.

**Regeln (einzige Stelle):** `scripts/src/lib/validation-scope.ts` — docs (nur `*.md`, `.agents/**`, `.local/**`, `attached_assets/**`) = kein E2E-Block; frontend (nur dienstplan `src|public|index.html`, mockup-sandbox ohne Build-Dateien) = nur Smoke; alles andere (inkl. unbekannter Pfade, e2e-Specs, Configs, leerer/unklarer Diff) = volle Kette.

**Why:** Volle Kette ≈ 40 min Rechenzeit pro Abschluss; reine UI-/Doku-Tasks brauchen sie nicht. Sicherheitsregel: im Zweifel alles — gemischte Änderungen eskalieren auf die strengste Kategorie.

**How to apply:** Neue Testblöcke oder Pfad-Kategorien NUR in `validation-scope.ts` ergänzen (Unit-Tests daneben). Debug: `pnpm --filter @workspace/scripts run scoped-e2e -- --dry-run`, `VALIDATION_SCOPE=docs|frontend|full`, `VALIDATION_DIFF_BASE=<ref>`. Achtung: die Gesamtausgabe von git wird getrimmt — Status-Zeilen nie über feste Spalten-Offsets parsen.

**Achtung Klassifizierung:** Ad-hoc-Dateien wie `artifacts/dienstplan/scripts/*.mjs` (Screenshot-Skripte) und `screenshots/*.png` zählen als "ausserhalb Doku/Frontend" und eskalieren die Merge-Validierung auf die volle Kette (~50 min, überschreitet das Poll-Budget). Bei reinen Frontend-Änderungen solche Beleg-Dateien möglichst nicht in den Diff aufnehmen — oder den Vollsuiten-Nachweis über den `e2e`-Workflow führen und die Completion-Validation mit Begründung überspringen.
