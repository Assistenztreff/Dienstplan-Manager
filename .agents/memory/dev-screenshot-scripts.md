---
name: Ad-hoc-Screenshot-/Seed-Skripte gegen den Dev-Stack
description: Fallstricke für einmalige Playwright/curl-Skripte gegen Dev-Stack (Ansicht explizit umschalten, API via curl statt node-fetch)
---

Einmalige Skripte (z. B. `artifacts/dienstplan/scripts/screenshot-*.mjs`) gegen den Dev-Stack (Seite `http://127.0.0.1:80/dienstplan`, API `http://localhost:8080`):

**Why:** Drei Fallstricke kosteten in #710 mehrere Iterationen:
1. **Ansicht ist nicht garantiert "Monat":** Frische Browser-Kontexte können auf der Tabelle (Desktop) bzw. Liste (Smartphone) landen — das Monatsgitter (`month-grid`) existiert dann nicht im sichtbaren Container und waitFor läuft in Timeouts. Immer explizit `view-toggles-desktop|mobile` → `view-toggle-grid` klicken (data-active prüfen) — so machen es auch die e2e-Specs (localStorage-Drift).
2. **node-fetch/undici bekommt die dev-login-Session nicht durch** (POST /api/shifts → 401 trotz Set-Cookie). API-Calls in Ad-hoc-Skripten zuverlässig via `curl` (execSync, Cookie-Jar-Datei `-b/-c`, Body per `--data-binary @datei` gegen Quoting-Probleme).
3. **Dev-DB ist belegt:** Schicht-Seeding muss Overlaps tolerieren (über Assistenzkräfte rotieren, bei `shift_overlap` die nächste nehmen; bestehende 24h-Dienste anderer Nutzer NICHT löschen). Seeds vor page load anlegen (React-Query-Cache) und im finally wieder löschen.

**How to apply:** Bei neuen Screenshot-/Seed-Skripten das Muster aus `scripts/screenshot-710.mjs` kopieren (api()-Helper via curl, Rotations-Seeding, view-toggle-Klick, Abnahme-Assertions, finally-Cleanup). Browser weiterhin mit `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` starten (siehe playwright-oneoff-chromium).
