---
tags: [projekt, dienstplan, handoff, abwesenheiten]
date: 2026-08-05
status: offen
---

# Handoff für neue Session: Menüpunkt „Abwesenheiten"

**Zweck dieser Notiz:** Eigenständiger Startpunkt, um in einer neuen Cowork-Session gezielt am Menüpunkt „Abwesenheiten" weiterzuarbeiten, ohne den ganzen Kalender-Chatverlauf neu erklären zu müssen. Bei Sessionstart: „lies zuerst `HANDOFF-abwesenheiten-menue.md` in 02 Projekte", dann direkt weitermachen.

## Kontext: wo das herkommt

Ursprünglich Teil der großen Kalenderansicht-Neustrukturierung (siehe `HANDOFF-naechste-session.md` und `Dienstplan-Kalenderansicht-Kompaktierung-Replit-Auftrag.md`, §8). Im Zuge dieser Arbeit wurde entschieden, Abwesenheiten komplett aus den Kalenderzellen zu entfernen und stattdessen eigenständig zu organisieren – das macht „Abwesenheiten" zu einem eigenen, klar abgrenzbaren Arbeitspaket.

**Wichtig:** Diese Notiz ersetzt/aktualisiert §8.1 und §8.5 der Arbeitsanweisung, die an diesen Punkten noch den alten Stand (Abwesenheiten-Balken im Kalender, Jahresansicht als Kräfte×Tage-Tabelle) beschreiben. Bei Widerspruch gilt diese Notiz als aktueller.

## Bisher entschiedener Stand

**Abwesenheiten raus aus dem Kalender:** Kalenderzellen (Monat und Tabellenansicht) zeigen keine Abwesenheits-Badges/-Balken mehr – bleiben schlicht, nur Diensteinträge.

**Leiste unter Kalender/Tabelle (bestehende Funktion bleibt, neu ist der Filter):**
- Zeigt weiterhin die Tagesansicht der aktuellen Dienste und Abwesenheiten (bisherige Funktion unverändert).
- Neu: zwei Dropdowns. Links = Anzeigetyp (Alle / Schichten / Abwesenheiten), Standard „Alle". Rechts = Zeitraum (Heute / Diese Woche / Dieser Monat / Nächste 2 Monate), Standard „Heute".
- Standardansicht gesamt: Heute, Alle (Schichten + Abwesenheiten des aktuellen Tages).

**Abwesenheitskalender (Menüpunkt „Abwesenheiten"):**
- Jahresansicht mit echten Mini-Monatskalendern (Tageszahlen, farbige Tage = Abwesenheit), nicht mehr die alte Kräfte×Tage-Tabelle.
- Layout: 2 Zeilen à 6 Monate.
- **Neu (05.08.2026): Die Monate sollen quadratisch dargestellt werden** (jeder Mini-Monat als Quadrat, nicht als breites Rechteck).
- Aufruf als Popup in größtmöglicher Größe (z. B. aus dem Dienstplan-Kalender heraus) UND als eigene Seite unter dem Menüpunkt „Abwesenheiten" – gleiches Kalender-Layout an beiden Stellen.
- Smartphone: eigene Anzeige-Logik nötig, da 12 Mini-Monate nicht nebeneinander passen – vorgeschlagen: vertikales Akkordeon, ein Monat pro Zeile mit Zähler „x Abwesenheiten", aktueller Monat automatisch aufgeklappt.
- Filter „Assistenzkraft: Alle ▾" oben, plus Farb-Chips als Legende (Gelb=geplant, Rot=Ausfall, Grau=Absage).

**Neu (05.08.2026) – zwei Wege, Abwesenheiten anzulegen:**
- Wie gehabt über das Auswahlmenü links (bestehender Dienst-/Abwesenheits-Dialog).
- Zusätzlich **direkt im Abwesenheitskalender** selbst: Klick auf einen Tag (bzw. Zeitraum per Start-/Endtag-Klick) legt die Abwesenheit direkt dort an, ohne Umweg über das linke Menü.

**Aus dem Assistenz-Connect-Vergleich mitzudenken** (siehe `Assistenz-Connect-Funktionsanalyse.md`, G9/G11/G12/G5) – eigenständig umgesetzt, nicht kopiert:
- Selbst-Krankmeldung direkt aus dem Abwesenheitskalender, bidirektional mit betroffenen Diensten verknüpft (nicht als getrennte Datenpflege).
- Kapazitätszeile pro Monat (Verfügbar/Geplant/Saldo), automatisch berechnet.
- Noch nicht final entschieden – als Vorschlag markiert, nicht als gesetzt behandeln.

## Referenz-Mockups (per Chat geliefert, siehe auch Cowork-Artefakte in der Desktop-Seitenleiste)

- `dienstplan-kalender-gesamtmockup-v2.html` – Desktop/Tablet/Smartphone-Kalender ohne Abwesenheiten in Zellen, plus Jahreskalender als Popup und als Seite (Layout dort noch als rechteckige Mini-Monate, vor der Quadrat-Vorgabe von heute)
- `tagesleiste-jahreskalender-v3.html` – Doppel-Filter-Leiste, Jahreskalender 2×6 Monate, Smartphone-Akkordeon
- `icon-design-final.html` – Menü-Icons (Emoji, 🕐 statt ⏱) + Pillen-Status-Icons (farbige Kreis-Badges)

## Nächste Schritte

- [ ] Jahreskalender-Mockup auf quadratische Monate umstellen (bisher rechteckig)
- [ ] Direkt-Anlage von Abwesenheiten im Kalender (Klick auf Tag/Zeitraum) als Interaktionsmodell ausarbeiten und mocken
- [ ] Selbst-Krankmeldung + Kapazitätszeile: Oli-Entscheidung einholen, ob/wann das mit rein soll
- [ ] Icon-Design final abnehmen lassen, dann in Arbeitsanweisung §2.1/§8 übertragen
- [ ] Danach: Tabellenansicht nach gleicher Designsprache (steht laut Haupt-Handoff weiterhin aus)
