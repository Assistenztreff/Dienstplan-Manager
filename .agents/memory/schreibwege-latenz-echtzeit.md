---
name: Schreibwege im Dienstplan müssen optimistisch sein (Echtzeit-Vorgabe)
description: Nicht Rechenzeit, sondern Roundtrips erzeugen die erlebte Wartezeit — sofort anzeigen, parallel schicken, nur Salden nachladen
---

**Kay-Vorgabe 01.09.2026:** Performance und Schnelligkeit sollen sich für eine
moderne Plattform wie Echtzeitgeschehen anfühlen. Jede neue Funktion ist von
vornherein so anzulegen. Das ist eine Grundregel, keine Optimierung „später".

**Der gelebte Fall.** Die automatische Planung brauchte für einen Monat 12–15 s,
ein Drag-and-Drop-Eintrag rund 1 s. Die Vermutung „der Server rechnet zu lange"
war falsch: Lokal (≈5 ms Latenz) lief dieselbe Monatsplanung in 1,1 s. Gemessen
wurden stattdessen **12 API-Requests, davon 5 sequenziell** — je Person ein
`POST /shifts/bulk` nacheinander, danach sieben Nachlade-GETs. Auf einer
Verbindung mit ~1 s Latenz je Roundtrip ergibt genau das die erlebte Wartezeit.
Ein Drop kostete 2 Roundtrips (POST, dann GET), bevor überhaupt etwas zu sehen
war.

**Merksatz:** Erlebte Wartezeit ≈ Anzahl der *nacheinander* laufenden Roundtrips
× Latenz. Millisekunden auf der Entwicklungsmaschine sagen darüber nichts aus.

**Regeln für jeden Schreibvorgang im Dienstplan:**

1. **Sofort anzeigen, dann fragen.** Das Ergebnis geht per `upsertShiftsInCache`
   in den Cache, *bevor* der Request rausgeht — mit `naechsteTempId()` (negative
   ID, kollidiert nie mit einer Server-ID). Nach der Antwort: temporäre Zeile per
   `removeShiftsFromCache` raus, echte rein. Bei Fehlschlag: temporäre Zeile raus
   und Fehler melden. Dadurch ist die Latenz für den Nutzer unsichtbar, egal wie
   groß sie ist.
2. **Vorläufige Zeilen sind nicht anklickbar.** `Shift.istVorlaeufig` setzen; das
   Monatsraster nimmt solche Pillen aus `chipClickable` heraus — ihre ID gibt es
   serverseitig noch nicht.
3. **Parallel, nie nacheinander.** Mehrere unabhängige Schreib-Requests über
   `Promise.allSettled` gleichzeitig schicken. `allSettled` statt `all`, damit ein
   Fehlschlag die übrigen nicht mitreißt und pro Auftrag zurückgerollt werden kann.
4. **Nur nachladen, was sich wirklich geändert hat.** Für Arbeitsdienste
   `invalidateArbeitsdienstSalden` verwenden: markiert `/api/shifts` nur als
   veraltet (`refetchType: "none"` — der Cache stimmt ja bereits) und lädt allein
   die beiden Stundenkonto-Salden nach. Das volle
   `invalidateShiftDerivedQueries` ist Abwesenheiten vorbehalten, die tatsächlich
   auf Urlaubskonto und Zeiterfassung wirken. `refetchType: "all"` ist fast immer
   zu viel: es refetcht auch inaktive Queries, also gecachte Nachbarmonate.

**Ergebnis der Umstellung:** Monatsplanung von 12 Requests (5 sequenziell) auf 5
parallele; sichtbares Ergebnis nach 224 ms statt nach allen Roundtrips.

**Wächter:** `e2e/dienstplan-schreibwege-roundtrips.spec.ts` verzögert die
Schreib-Requests künstlich um 700 ms und besteht nur, wenn das Ergebnis **vor**
Ablauf einer Latenz im Raster steht und die Schreibphase etwa eine Latenz dauert
(nicht fünf). Der Test misst bewusst Roundtrips und Reihenfolge statt
Millisekunden — absolute Zeiten hingen an der Maschine und wären als Schwelle
wertlos.
