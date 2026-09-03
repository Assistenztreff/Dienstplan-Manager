---
name: Zeitumstellung — ein Tagesdienst dauert nicht immer 24 Stunden
description: Warum die Dauerpruefung von Diensten auf der Uhr rechnen muss und nicht in Millisekunden
---

Ein 24-Stunden-Dienst von 09:00 bis 09:00 dauert an den beiden
Umstellungswochenenden NICHT 24 Stunden:

- Ende der Sommerzeit (Oktober, Uhr zurueck): real **25 Stunden**.
- Beginn der Sommerzeit (Maerz, Uhr vor): real **23 Stunden**.

Auf der Uhr an der Wand sind es beide Male 24 — und genau so ist der Dienst
geplant.

## Was das kostete

Kay-Fehlermeldung 03.09.2026: Die automatische Planung besetzte Oktober 2026.
Der Sammelauftrag EINER Person enthielt den Dienst vom 24. auf den 25. Oktober
(Umstellung). `POST /shifts/bulk` verglich `endTime - startTime` mit 24 Stunden
in Millisekunden, sah 25 und antwortete 400 „Ungültiger Tageseintrag: Ende muss
nach dem Beginn liegen und innerhalb eines Kalendertags enden."

Weil ein Sammelauftrag ganz oder gar nicht angelegt wird, verlor diese Person
ihren KOMPLETTEN Monat — sieben Tage blieben leer, und im Stundenkonto stand
sie bei 0 von 167 Stunden. Der Fehler sah nach einem Fehler der Verteilung aus,
lag aber in einer Datumsrechnung.

## Die Regel

`artifacts/api-server/src/lib/dienst-dauer.ts` rechnet die Dauer auf der Uhr:

```
wanduhrDauerMs = ende - start + (versatz(ende) - versatz(start))
```

`versatz` ist der Abstand der Berliner Ortszeit zur Weltzeit an diesem
Zeitpunkt. `istTagesdienst()` prueft dagegen die 24-Stunden-Grenze. Ein echter
Mehrtages-Dienst (49 reale Stunden ueber die Umstellung) faellt weiterhin
durch.

Fest verdrahtet auf `Europe/Berlin`: Die App ist auf deutsches Arbeitsrecht
zugeschnitten (ArbZG, MiLoG, SGB IV), eine Zeitzone je Team gibt es bewusst
nicht. Ein konfigurierbarer Wert waere solange nur eine Attrappe.

## Warum kein Test das gefunden hat

Der Testcontainer laeuft in UTC. Dort gibt es keine Umstellung, ein
09:00–09:00-Dienst dauert immer exakt 24 Stunden, und die
Millisekunden-Pruefung war grün. Deshalb baut
`dienstplan-zeitumstellung-api.spec.ts` die Zeitpunkte MIT Offset
(`...T09:00:00+02:00` → `...T09:00:00+01:00`) statt aus lokalen Date-Objekten —
so haengt der Test nicht an der Zeitzone des Containers. Das Datum sucht er
sich selbst: die naechste echte Umstellung ab heute, kein festes Datum, das in
einem Jahr verrottet.

**Beim Schreiben neuer Dauer-, Nacht- oder Zuschlagsrechnungen daran denken:**
Alles, was „ein Tag" oder „24 Stunden" bedeutet, gehoert auf die Uhr gerechnet.
Fuer die BEZAHLUNG gilt umgekehrt die echte Dauer — wer 25 Stunden da war, hat
25 Stunden gearbeitet.
