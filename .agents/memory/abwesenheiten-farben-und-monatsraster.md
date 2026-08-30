---
name: Abwesenheits-Farben und der blinde Fleck im Monatsraster
description: Offene Punkte — drei Farbgruppen statt echter Typ-Farben im Abwesenheitskalender, und auf dem Desktop zeigt das Monatsraster Abwesenheiten gar nicht an.
---

# Offen: Abwesenheiten sind je nach Ansicht unterschiedlich (oder gar nicht) sichtbar

**Status: gefunden am 30.08.2026, NICHT behoben.** Kay-Idee fuer spaeter, plus
ein Bestandsproblem, das dabei aufgefallen ist.

## Drei Orte, drei Darstellungen

| Ansicht | Was eine Abwesenheit zeigt |
|---|---|
| Dienst-Dialog (Typ-Auswahl) | Eigene Farbe je Art (10 Punkte, s. shift-dialog.tsx) |
| Tagesleiste / Tabelle | Pille in der Typ-Farbe (SHIFT_TYPE_CLASSES, dienstplan-helpers.tsx) |
| Abwesenheitskalender | Nur DREI Kategoriefarben: geplant/ausfall/absage (ABSENCE_CATEGORY, abwesenheits-kalender.tsx) |
| Monatsraster Smartphone | Nur ein Zaehler "N Abw." — keine Farbe, kein Typ |
| Monatsraster Desktop | **GAR NICHTS** |

Der letzte Punkt ist der schwerwiegendere: Der Zaehler "N Abw." haengt in
month-grid.tsx im `collapsed`-Zweig (Smartphone). Der `full`-Zweig
(Desktop/Tablet) hat kein Gegenstueck. Auf dem Desktop ist ein Abwesenheitstag
darum von einem unverplanten Tag nicht zu unterscheiden — beide Zellen sind
leer. Kay stolperte darueber, als ein genehmigter Wunschfrei-Tag den Dienst
verdraengte und die Person "einfach verschwand".

## Kays Idee (30.08.2026)

Die Farben aus dem Dienst-Dialog auch im Abwesenheitskalender nutzen, statt der
drei Kategoriefarben — und die Abwesenheitsarten wie bei AssistenzConnect als
Legende OBEN im Kalender darstellen (dort eine Reihe farbiger Chips:
Urlaub / Krank / Freistellung / Kind krank / Wunschdienst / Wunschfrei / …).

## Beim Umsetzen beachten

- Die drei Kategoriefarben waren eine bewusste Entscheidung (HANDOFF, Kommentar
  in abwesenheits-kalender.tsx: "3 Kategoriefarben statt 8 Einzelfarben"). Wer
  sie ersetzt, kippt diese Entscheidung — vorher mit Kay klaeren, ob die
  Gruppierung ganz entfaellt oder als zusaetzlicher Filter bleibt.
- Zehn Farben muessen im Jahreskalender auf sehr kleinen Flaechen noch
  unterscheidbar sein. Die Legende oben ist dann keine Zierde, sondern
  Voraussetzung.
- Der fehlende Desktop-Hinweis im Monatsraster laesst sich unabhaengig davon
  beheben und waere der groessere Gewinn.
