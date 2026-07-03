---
name: Dev-Seeder vs. manuell umgebauter DB-Zustand
description: Auto-Login-/Seed-Routinen können per Skript umgebaute Dev-Daten still rückgängig machen
---

Der Dev-Auto-Login (`ensureDevTestUsers` in auth.ts) läuft bei JEDEM bodyless
`POST /auth/dev-login` — also automatisch bei jedem Öffnen der Vorschau. Jede
"ensure"-Logik darin (z. B. Team-Mitgliedschaft des Test-Assistenten) macht
manuelle oder per Skript vorgenommene DB-Umbauten still wieder rückgängig.

**Why:** Nach dem Testkonten-Umzug (Test-Assistent aus Team 1 ins
Betreiber-Team) tauchte er nach dem nächsten Vorschau-Load wieder in Team 1
auf — der Seeder hatte die Mitgliedschaft per onConflictDoNothing neu angelegt.

**How to apply:** Wenn ein Skript Dev-Datenbestände umbaut, alle
Seed-/ensure-Pfade prüfen (dev-login, setup-Skripte), die denselben Zustand
"sicherstellen". Ensure-Logik als reinen Bootstrap gestalten (nur anlegen,
wenn noch GAR NICHTS existiert), nicht als Dauer-Reparatur.
