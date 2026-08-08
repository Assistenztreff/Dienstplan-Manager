---
name: Validation poll budget vs. lange E2E-Kette
description: markTaskComplete-Validierung stirbt an POLL_BUDGET_EXCEEDED, hinterlässt stale run.locks; Umgang damit.
---

Die registrierte e2e-Validierungskette (test:db + test:e2e:api + test:e2e:smoke) dauert >45 min und überschreitet regelmäßig das Poll-Budget des Validierungs-Pollers (POLL_BUDGET_EXCEEDED), obwohl die Tests grün durchlaufen. Der abgebrochene Hintergrundlauf läuft zunächst weiter und hält `node_modules/.cache/dienstplan-e2e/run.lock`; wird er gekillt, bleibt der Lock stale und jeder Folgeversuch schlägt sofort fehl.

**How to apply:**
- Vor jedem Retry: Lock-PID prüfen (`cat run.lock` → `ps -p`), bei totem Halter Lock löschen.
- Log-Dateien abgebrochener Läufe werden nicht mehr gedraint — Stillstand im Log heißt nicht, dass der Prozess hängt; Prozessliste prüfen.
- Bei rein frontend-/mockup-seitigen Änderungen und mehrfach beobachtetem grünem Verlauf ist `skip_validation_reason` mit dokumentierter Begründung der gangbare Abschlussweg.
- Achtung: `pgrep -f playwright` matcht die eigene Shell-Kommandozeile — mit `ps aux | grep "[@]playwright"` prüfen.
- Der e2e-Workflow als Nachweis-Lauf funktioniert (scoped-e2e komplett gruen, ~31 Min), ABER: ein paralleler Merge eines anderen Tasks startet ALLE Workflows neu und killt dabei einen laufenden e2e-Workflow-Lauf mitten in der Tail-Lane. Bei aktiver Merge-Schlange mit Wartezeit rechnen oder Lauf nach dem Merge erneut prüfen.
