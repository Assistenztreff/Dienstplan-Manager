---
name: Urlaubs-POSTs in E2E langsam
description: Jeder Vacation/Sick-POST kostet im E2E-Test-Stack ~5s (serverseitige Urlaubskonto-Neuberechnung) — Timeouts und sequentielle Anlage entsprechend dimensionieren.
---

# Urlaubs-POSTs sind im E2E-Stack langsam (~5 s pro Request)

Ein einzelner `POST /api/shifts` mit Typ `vacation` (gilt vermutlich auch `sick`)
dauert im Playwright-Test-Stack rund **5 Sekunden** (Trace: `wait` ≈ 4,7 s
serverseitig). Ursache: Read-Modify-Write des Urlaubskontos plus Nachberechnungen
pro angelegtem Tag.

**Why:** Mehrtägige Abwesenheiten werden clientseitig sequentiell angelegt
(ein Tag = ein Request). Bei 3 Tagen ≈ 15 s — ein Default-Timeout (5 s) oder
knapp bemessenes explizites Timeout schlägt fehl, obwohl alles funktioniert.
Diagnose-Falle: Der Dialog bleibt ohne Fehlermeldung offen und sieht wie ein
Hänger aus.

**How to apply:** E2E-Specs, die mehrtägige Abwesenheiten über die UI anlegen,
brauchen großzügige Timeouts (≥ 30 s) und sollten die Tageszahl klein halten
(2 Tage genügen meist). Seeding von Abwesenheiten besser direkt per API vor
dem Seitenaufruf statt über die UI.
