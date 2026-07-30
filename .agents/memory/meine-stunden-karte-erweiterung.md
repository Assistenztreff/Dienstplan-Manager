---
name: Meine-Stunden-Karte Erweiterung
description: Welche Felder in MeineStundenKarte sichtbar sind und wie die Logik aufgebaut ist.
---

# MeineStundenKarte — aktuelle Anzeigelogik

`artifacts/dienstplan/src/components/meine-stunden-karte.tsx`

Immer sichtbar (wenn > 0): IST-Stunden/Soll, Krankheitsstunden, Urlaubstage, Kind-krank-Tage.
Nur wenn `hourlyWage != null`: Grundlohn, Nachtzuschlag, Sonntagszuschlag, Feiertagszuschlag,
SV-pflichtig (Urlaub/Krank), Gesamtlohn.

**Why:** Die API liefert alle Felder bereits; die Karte filtert per `hourlyWage != null` Gate.
**How to apply:** Neue Lohnzeilen immer innerhalb des `{hasWage && (...)}` Blocks ergänzen.
