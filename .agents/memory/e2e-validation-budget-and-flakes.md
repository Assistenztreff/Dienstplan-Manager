---
name: E2E-Gesamtsuite: Laufzeit, Flakes und Validierungsbudget
description: Regeln für die lange Playwright-Kette, parallele Ausführung, Poll-Budget, Locks und gezielte UI-Validierung
---

Die volle E2E-Kette dauert typischerweise 36–45 Minuten und kann die Poll-Grenze einer Completion-Validation überschreiten. Sie läuft heute als parallele, DB-isolierte API-Shards plus serieller Smoke-Block; ein Fehler in einem Block lässt die gesamte Workflow-Validierung rot werden.

**Why:** Mehrere historische Einträge beschrieben verschiedene Symptome derselben Rahmenbedingung: Ein globaler Timeout kann eine langsame, aber lebende Suite treffen; `POLL_BUDGET_EXCEEDED` kann Prozesse weiterlaufen lassen; überlappende Läufe können den Lock halten; UI-Änderungen brauchen bei aktualisierten Handbuchbildern eine Capture-Regeneration.

**How to apply:**
- Für eine konkrete Änderung zuerst gezielte Specs laufen lassen; bei einem Fehler im Smoke-Block den einzelnen Spec reproduzieren, dann den vollständigen Smoke-Block — nicht reflexhaft die Vollsuite.
- Eine erfolgreiche Vollsuite als separaten Workflow-Nachweis dokumentieren und bei bekannter Poll-Grenze den Completion-Check mit belastbaren Teilnachweisen überspringen.
- Für den separaten Vollsuiten-Nachweis den konfigurierten `e2e`-Workflow starten (überlebt Sitzungsgrenzen) — nohup/setsid-Hintergrundläufe aus der Shell werden gereapt und hinterlassen keine Logs.
- Läuft parallel noch eine (abgebrochene) Validation, kann deren Codegen-Schritt den Typecheck eines zweiten Laufs transient rot machen (generierte Dateien kurzzeitig fehlend) — lokal verifizieren statt debuggen.
- Bei angeblich hängendem Lauf Prozess/Lock-PID prüfen; bei tatsächlich abgebrochenem Poll-Lauf Zombies beenden und einen stale Lock erst dann entfernen. `acquireRunLock` wartet bis `E2E_LOCK_WAIT_MS` (15 Minuten) auf einen lebenden Inhaber.
- `playwright.config` nicht aus Teardown-Code importieren: Konfigurations-Import hat Seiteneffekte (u. a. Lock-Setup).
- Handbuchrelevante UI-Änderungen: Capture nur auf ausdrücklichen Auftrag des Nutzers ausführen; dann Fingerprint aktualisieren, sonst blockiert der Validierungsgate.
## Rote Specs auf main (Stand 18.08.2026)
`dienstplan-absence-bar.spec.ts` und `dienstplan-bulk-delete-assistant-filter.spec.ts` schlagen auf main fehl (shift-badge-Sichtbarkeit in `dienstplan-desktop` bzw. `day-detail-panel`; teils 60s-Gesamttimeout im Cleanup). Unabhängig vom Tabellenzellen-Redesign nachgewiesen (git stash → gleicher Fehler ohne die Änderung).
**How to apply:** Bevor man bei Tabellen-/Tagesleisten-UI-Änderungen eine Spec-Rotfärbung der eigenen Änderung zuschreibt: Änderung stashen und die Spec auf main gegenlaufen lassen.
