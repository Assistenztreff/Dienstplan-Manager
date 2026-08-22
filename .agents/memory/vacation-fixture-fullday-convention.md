---
name: Test-Fixtures für Abwesenheiten müssen die ganztägige UTC-Konvention treffen
description: Seit "Halbtägiger Urlaub" (#862) prüft die UI isPlainFullDayIso (00:00–23:59 UTC) statt jede Abwesenheit pauschal als "ganztägig" zu zeigen; ältere Fixtures mit z.B. 08:00–16:00 zeigen jetzt eine echte Zeitspanne.
---

Vor #862 zeigte die Tagesleiste jede Abwesenheits-Schicht (type vacation/
krank/...) unabhängig von den gespeicherten Uhrzeiten immer als "ganztägig"
an. Seit #862 (Halbtägiger Urlaub) prüft die Anzeige stattdessen
`isPlainFullDayIso(startTime, endTime)` — nur ein Eintrag mit exakt
00:00:00–23:59:00 UTC gilt als ganztägig; jede andere Zeitspanne (z. B. eine
ältere Test-Fixture, die aus Bequemlichkeit 08:00–16:00 UTC nutzt) rendert
jetzt korrekt die echte Uhrzeit-Spanne statt "ganztägig".

**Why:** ein e2e-Fixture, das eine Abwesenheit mit denselben Hilfsfunktionen
wie normale Arbeitsschichten anlegt (z. B. ein gemeinsames `shiftTimes(day)` →
08:00–16:00), bricht dadurch scheinbar zufällig nach dem #862-Merge, obwohl
die Anzeige-Logik korrekt arbeitet — der Fehler liegt im Fixture, nicht im
Code.

**How to apply:** jede neue oder bestehende Abwesenheits-Fixture in e2e-Specs
muss explizit `startTime: ...T00:00:00.000Z` und `endTime: ...T23:59:00.000Z`
setzen, wenn der Test "ganztägig" erwartet. Für gezielt halbtägige
Abwesenheits-Tests stattdessen eine echte Teil-Zeitspanne verwenden und
`formatAbsenceTimeSpan`-Text erwarten, nicht "ganztägig".
