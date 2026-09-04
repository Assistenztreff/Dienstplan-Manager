---
name: Tageszelle — besetzte Pillen und offene Plaetze stehen gemeinsam nach Uhrzeit
description: Warum die Reihenfolge in der Monatszelle ueber CSS `order` laeuft und nicht ueber die DOM-Reihenfolge
---

Kay-Fehlermeldung 03.09.2026: Im Drei-Schicht-Modell rutschte der Nachtdienst
nach oben, sobald Frueh- und Spaetdienst am selben Tag noch offen waren. Ein
Dienstplan, in dem 22:00 ueber 06:00 steht, ist nicht lesbar.

**Die Ursache** war nicht die Sortierung — beide Listen sind fuer sich
chronologisch. Die Zelle zeichnete nur erst ALLE besetzten Pillen
(`visiblePills`) und danach ALLE Platzhalter (`sichtbarePlaetze`). Ein
besetzter Nachtdienst stand damit zwangslaeufig ueber einem offenen
Fruehdienst.

**Die Loesung:** `zeitReihe` fasst beide Listen zu einer gemeinsamen Zeitreihe
zusammen und `reihenfolge` haelt je Element seinen Rang. Jede Huelle bekommt
ihn als CSS-`order` mit; der Flex-Container zeichnet danach.

**Warum ueber CSS und nicht ueber die DOM-Reihenfolge:** Der Zellen-Aufbau
haette dafuer in allen DREI Pillen-Varianten (Smartphone, Desktop minimiert,
Desktop voll) umgebaut werden muessen — jede mit eigenem, mehrere hundert
Zeilen langem Markup. `order` erreicht dasselbe mit fuenf Zeilen und ohne
Risiko fuer den Rest der Zelle. Der Preis ist bekannt: Vorlese-Programme lesen
die Dokument-Reihenfolge, nicht die sichtbare. Vertretbar, weil jede Pille ihre
Uhrzeit und ihren vollen Namen selbst im `aria-label` bzw. `title` traegt und
die Zelle als Ganzes beschriftet ist.

**Fuer Tests wichtig:** Die Reihenfolge ist NICHT ueber die DOM-Position
pruefbar. `dienstplan-schicht-reihenfolge.spec.ts` misst deshalb die
`boundingBox().y` der Elemente. Wer hier auf `nth()` oder die Reihenfolge im
Markup prueft, testet am Verhalten vorbei.


## Nachtrag: JEDES Element der Zelle braucht seine Position

Kay-Fehlermeldung 03.09.2026: Im Drei-Schicht-Modell sammelten sich alle
Vertretungszeilen unter der ERSTEN Dienstpille des Tages, statt jeweils unter
ihrer eigenen.

Grund: Die Pillen und die Platzhalter bekamen eine `order`, die Vertretungs-
zeile nicht — sie fiel damit auf den CSS-Standard `order: 0` zurueck und
sortierte sich vor bzw. zwischen die frueheste Gruppe.

Die Zeile traegt jetzt DIESELBE Position wie ihr Dienst. Bei gleichem Wert
zeichnet der Flex-Container in Dokument-Reihenfolge, also Pille und direkt
darunter ihre Zeile.

**Die Regel dahinter, fuer jede weitere Zeile in der Tageszelle:** Sobald ein
Container mit `order` sortiert, braucht JEDES seiner Kinder einen Wert. Ein
vergessenes Kind faellt nicht ans Ende, sondern auf 0 — also nach ganz oben.
Das ist der Preis der CSS-Sortierung und der Grund, warum
`dienstplan-schicht-reihenfolge.spec.ts` die Abfolge Pille/Zeile/Pille/Zeile
komplett durchmisst statt nur die Pillen.
