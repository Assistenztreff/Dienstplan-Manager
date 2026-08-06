---
name: Parallele E2E-Lanes teilen api-server dist/
description: Shard-WebServer bauen gleichzeitig nach artifacts/api-server/dist — MODULE_NOT_FOUND dist/index.mjs ist ein transienter Build-Race, kein Testfehler.
---

# Build-Race: parallele E2E-Lanes teilen `artifacts/api-server/dist`

Die parallelen scoped-e2e-Lanes (api-shard-1/-2) starten je einen eigenen
Playwright-webServer, der vorher `pnpm run build` im api-server ausführt —
alle in **dasselbe** `dist/`-Verzeichnis. Baut Lane A gerade neu, während
Lane B `node dist/index.mjs` startet, stirbt B mit
`Error: Cannot find module '.../api-server/dist/index.mjs'`
(Process from config.webServer was not able to start).

**Why:** Sieht im Log wie ein echter Fehler aus, ist aber reines Timing —
die andere Lane läuft im selben Lauf fehlerfrei durch. Auch der
Dev-Workflow des api-servers (`build && start`) schreibt in dasselbe dist/
und kann kollidieren, wenn er während eines E2E-Laufs neu startet.

**How to apply:** Bei diesem Fehlerbild nicht am Code zweifeln und keine
Specs anfassen — Kette (oder betroffene Lane) nach dem Race-Fenster einfach
neu starten. Nur wenn der Fehler wiederholt auftritt, lohnt ein Harness-Fix
(z. B. lane-eigene Build-Ausgabepfade oder serialisierter Build vor den
Lanes).
