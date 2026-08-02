---
tags: [projekt, dienstplan, replit-auftrag]
date: 2026-08-02
---

# Arbeitsanweisung für den Replit Agenten: Kalenderansicht kompaktieren

> Zum Copy-Paste als Nachricht an den Replit Agenten im Repo `Assistenztreff/Dienstplan-Manager`.

## Kontext

Die aktuelle Monatsansicht im Dienstplan-Manager ist deutlich zu großzügig dimensioniert (große leere Tageszellen, große farbige Balken pro Dienst). Vorbild für die Kompaktheit ist die Konkurrenz-App **Assistenz Connect** (`app.assistenz-connect.de`) – deren Layout soll als Referenz für Dichte/Proportionen dienen, **nicht** für Farben oder Stil. Das Design soll sich klar über unser eigenes Corporate Design abheben.

## Ziel

Die Monats-Kalenderansicht so kompaktieren, dass:
- die komplette Monatsansicht (bei leerem oder wenig gefülltem Monat) vollständig sichtbar ist, sobald die Menüleiste „Dienstplan" beim Herunterscrollen oben sticky einrastet,
- mehrere Diensteinträge pro Tag ähnlich platzsparend wie bei Assistenz Connect dargestellt werden,
- die Bedienung auf dem iPad (Touch) intuitiv bleibt.

## 1. Sticky-Header & vollständige Monatsanzeige

- Die obere Menüleiste „Dienstplan" (inkl. Monatsnavigation, Ansichts-Umschalter Tabelle/Monat, Monats-PDF-Export, Mehrfachauswahl) soll beim Scrollen **sticky** oben bleiben.
- Die Wochentags-Kopfzeile (Mo–So) soll ebenfalls **sticky** direkt unter der Menüleiste bleiben, unabhängig davon, wie weit im Monat nach unten gescrollt wurde.
- **Wichtig – Reihenfolge des Verhaltens:** Die kompakte Monatsansicht wird erst dann vollständig (alle Wochenzeilen) angezeigt, **wenn die Menüleiste beim Herunterscrollen ihren Sticky-Zustand oben erreicht hat** – genau wie in den beiden mitgeschickten Screenshots zu sehen (leerer August 2026 bzw. gefüllter Juli 2026, jeweils mit oben fixierter Leiste). Vor diesem Scroll-Punkt darf oberhalb des Kalenders regulärer Seiteninhalt/Abstand stehen; ab dem Sticky-Einrasten nutzt der Kalender dann den verbleibenden sichtbaren Bereich möglichst vollständig aus.

## 2. Zellengröße & Skalierung

- Sobald die Menüleiste sticky ist: Alle Wochenzeilen des aktuell sichtbaren Monats sollen sich so einpassen, dass sie **ohne weiteres Scrollen** in den verbleibenden Bildschirmbereich passen (Zeilenhöhe dynamisch an verfügbare Höhe anpassen, ähnlich der Referenz-App), solange die Füllstands-Bedingung aus Punkt 3 erfüllt ist.
- **Datumszahl** in jeder Zelle: Schriftgröße ungefähr wie bei Assistenz Connect (deutlich kleiner als aktuell, klein und dezent oben in der Zelle).
- **Pillen-/Diensteinträge**: Darstellung als kompakte "Pille" mit Assistenzkraft-Initialen (bzw. Kürzel wie aktuell "A3", "A7" etc.) und Uhrzeit von–bis, in etwa gleicher Höhe wie die Einträge bei Assistenz Connect (aktuell deutlich zu groß). Zur Schriftgröße innerhalb der Pille siehe Punkt 2.1.

### 2.1 Typografie innerhalb der Pille

- Initialen/Kürzel und Uhrzeit (von–bis) sollen in der **größtmöglichen Schriftgröße** dargestellt werden, die noch mit **leichtem Innenabstand zum Rand** der Pille in diese hineinpasst (nicht am Rand anstoßend, aber auch keine großzügige Luft wie aktuell).
- Praktisch: Schriftgröße responsiv an die verfügbare Pillenhöhe/-breite koppeln (z. B. `clamp()` oder JS-basierte Auto-Fit-Logik), mit einem sehr kleinen festen Innenabstand (Richtwert 2–4 px, iOS/iPad-tauglich).
- Initialen und Uhrzeit bleiben zweizeilig wie bisher (Kürzel oben, Uhrzeit darunter), beide Zeilen jeweils maximal ausgereizt innerhalb der Pille.

## 3. Dynamisches Höhenverhalten pro Zelle

- **0 Einträge:** Zelle zeigt nur Datum + Plus-Symbol (siehe Punkt 4), volle Kompaktheit.
- **1–2 Einträge:** Zelle wächst leicht, aber die **gesamte Monatsansicht bleibt weiterhin scrollfrei im sichtbaren Bereich unterhalb der sticky Leiste** – d. h. die Zeilenhöhe aller Wochen passt sich weiter dynamisch an, es wird nicht in die Länge gezogen.
- **3 oder mehr Einträge** (z. B. durch zusätzliche Abwesenheits-Balken – gelb für Urlaub, rot für Krankheit): Erst ab diesem Punkt darf die Monatsansicht nach unten wachsen und ein vertikales Scrollen innerhalb der Seite notwendig werden. Die Sticky-Header (Menüleiste + Wochentage) bleiben dabei weiterhin fixiert oben.

## 4. Plus-Symbol für leere Zellen

- Jede Tageszelle **ohne** Diensteintrag zeigt ein dezentes **„+"**-Symbol.
- Klick/Tap auf das „+" öffnet **direkt** das Menü zur Planung eines neuen Diensts oder einer Abwesenheit für diesen Tag (ohne den bisherigen Zwischenschritt „erst antippen zum Markieren, dann nochmal antippen zum Öffnen").
- Bei Zellen mit bereits vorhandenen Einträgen: ebenfalls ein kleines „+" unterhalb der bestehenden Pillen anzeigen, um einen weiteren Dienst am selben Tag per Direktklick hinzuzufügen.

## 5. Interaktionsmodell – Einzelauswahl vs. Mehrfachauswahl

**Empfehlung: Beide bestehenden Mechanismen beibehalten, nicht auf einen reduzieren.**

- **Einfacher Klick auf leere Zelle / „+":** öffnet direkt den Planungsdialog für diesen einen Tag (ersetzt den bisherigen Zwei-Klick-Schritt bei leeren Tagen, siehe Punkt 4).
- **Klick auf eine bestehende Zelle mit Diensten (nicht auf „+"):** bestehendes Verhalten beibehalten – erster Klick markiert/hebt den Tag hervor, zweiter Klick öffnet das Menü zum Bearbeiten/Ergänzen.
- **Doppelklick/Doppeltipp auf eine Zelle:** bleibt wie bisher der Einstieg in die Mehrfachauswahl (zusammen mit dem „Mehrfachauswahl"-Button oben), um mehrere Tage für Serien-Diensteplanung oder Sammel-Löschung auszuwählen.

**Begründung:** Die drei Gesten überschneiden sich nicht – das „+" ist ein eigener, klar sichtbarer Tap-Ziel-Bereich für die schnelle Einzelplanung (besonders touch-freundlich), während Doppelklick als bewusst andere Geste ausschließlich für den bereits etablierten Mehrfachauswahl-Workflow reserviert bleibt. Eine Zusammenlegung würde entweder die schnelle Einzelplanung erschweren (kein direktes „+" mehr) oder den Mehrfachauswahl-Workflow riskieren (Doppelklick-Erkennung ist auf Touch ohnehin fehleranfällig, z. B. Konflikt mit Zoom-Gesten) – daher beide Mechanismen parallel beibehalten.

## 6. Eigenständiges Corporate Design (Abgrenzung zu Assistenz Connect)

Nur die **Kompaktheit/Proportionen** von Assistenz Connect als Vorbild nehmen – Farben, Iconografie und Gesamtlook sollen klar erkennbar AssistenzTreff sein, mit folgender Farbpalette:

| Verwendung | Farbe | Hex |
|---|---|---|
| Primär (Header, Akzente, Text dunkel) | Dunkelblau | `#092948` |
| Sekundär hell (Hintergründe, Hover) | Mint/Hellblau | `#d4f0f0` |
| Akzent 1 | Limette | `#cae677` |
| Akzent 2 | Hellgelb-Grün | `#ebf18b` |
| Hintergrund neutral | Off-White | `#f9f9f9` |
| Akzent 3 (z. B. Abwesenheits-/Warnfarbe warm) | Pfirsich | `#fed4b1` |
| Kontrast/Dunkel-Akzent | Dunkles Aubergine/Lila | `#26092e` |

- Diese Markenpalette ist ausschließlich für UI-Chrome (Menüleiste, Hintergründe, Buttons, Rahmen) zu verwenden – **nicht** für die Zuordnung der Assistenzkräfte-Farben (siehe Punkt 7).
- Urlaub weiterhin gelb, Krankheit weiterhin rot markieren (Balken über der Zelle bzw. über den Einträgen) – Signalfarben sind reservierte Statusfarben, unabhängig vom Corporate-Schema und von der Assistenzkräfte-Palette, und dürfen für nichts anderes wiederverwendet werden.

## 7. Eigenes Farbschema für Assistenzkräfte (getrennt vom Corporate Design)

Die Farbcodierung der Diensteinträge je Assistenzkraft folgt einem **eigenen, von der Markenpalette getrennten Kategorial-Schema** mit **zwei wählbaren 12er-Paletten** (nicht 8 – auf Teamgrößen bis 12 Assistenzkräfte ausgelegt). Der Nutzer kann in den **Einstellungen** zwischen beiden Paletten umschalten:

### 7.1 Helle Palette (12 Slots, für schwarze/dunkle Schrift)

Feste, geprüfte Werte – 1:1 übernehmen, nicht selbst mischen. Reihenfolge ist bereits nach maximaler gegenseitiger Unterscheidbarkeit optimiert (Farthest-Point-Auswahl im Lab-Farbraum): Slot 1 zuerst vergeben, dann Slot 2 usw. – auch kleine Teams (z. B. 4 Assistenzkräfte = Slot 1–4) sind dadurch bereits maximal unterscheidbar, ohne dass später umsortiert werden muss.

| Slot | Hex | Kontrast ggü. Schwarz `#000000` |
|---|---|---|
| 1 | `#8ada62` | 12,29 : 1 |
| 2 | `#9f73de` | 5,98 : 1 |
| 3 | `#73ccde` | 11,42 : 1 |
| 4 | `#de9f73` | 9,31 : 1 |
| 5 | `#cbb6e7` | 11,38 : 1 |
| 6 | `#de73ba` | 7,27 : 1 |
| 7 | `#de737c` | 6,85 : 1 |
| 8 | `#e0d6a3` | 14,32 : 1 |
| 9 | `#62da94` | 11,98 : 1 |
| 10 | `#7396de` | 7,15 : 1 |
| 11 | `#dec373` | 12,16 : 1 |
| 12 | `#b6d3e7` | 13,46 : 1 |

Textfarbe für diese Palette: **Schwarz `#000000`**, fett (siehe Punkt 2.1 zur Größe). Alle 12 Werte liegen über dem WCAG-AA-Minimum von 4,5 : 1.

### 7.2 Dunkle Palette „Golden-Winkel" (12 Slots, für weiße Schrift)

Ebenfalls feste, geprüfte Werte, Hues nach dem Goldenen-Winkel-Prinzip (Schrittweite ~137,5°) angeordnet – dadurch ist auch hier jede Teilmenge von Anfang an (erste 4, erste 8 ...) maximal gestreut, nicht nur die vollen 12.

| Slot | Farbname | Hex | Kontrast ggü. Weiß `#ffffff` |
|---|---|---|---|
| 1 | Rosa-Rot | `#701a28` | 11,25 : 1 |
| 2 | Grün | `#1a7025` | 6,20 : 1 |
| 3 | Violett | `#3e1a70` | 13,24 : 1 |
| 4 | Ocker | `#70571a` | 6,85 : 1 |
| 5 | Petrol | `#1a6f70` | 5,91 : 1 |
| 6 | Magenta | `#701a57` | 10,64 : 1 |
| 7 | Olivgrün | `#3e701a` | 5,94 : 1 |
| 8 | Indigo | `#1a2570` | 13,61 : 1 |
| 9 | Terracotta | `#70281a` | 10,46 : 1 |
| 10 | Smaragd | `#1a7041` | 6,11 : 1 |
| 11 | Lila | `#5a1a70` | 11,56 : 1 |
| 12 | Gelbgrün | `#6c701a` | 5,29 : 1 |

Textfarbe für diese Palette: **Weiß `#ffffff`** (siehe Punkt 2.1 zur Größe). Alle 12 Werte liegen über dem WCAG-AA-Minimum von 4,5 : 1.

### 7.3 Einstellungen-Umschalter & Zuweisungslogik

- In den **Einstellungen** wählt der Nutzer aus, welche der beiden Paletten (7.1 „Hell" oder 7.2 „Dunkel – Golden-Winkel") aktuell verwendet wird. Die Auswahl gilt global für den gesamten Kalender (Text- und Hintergrundfarbe der Pillen wechseln gemeinsam, siehe Textfarbe pro Palette oben).
- **Zuordnung pro Assistenzkraft erfolgt über die Slot-Nummer, nicht über den Hex-Wert direkt:** Jede Assistenzkraft bekommt beim Anlegen fortlaufend den nächsten freien Slot (1, 2, 3, ...) zugewiesen – in der Reihenfolge aus 7.1 bzw. 7.2, je nachdem welche Palette gerade aktiv ist. Wechselt der Nutzer später die Palette in den Einstellungen, behält jede Assistenzkraft ihre Slot-Nummer und bekommt automatisch die entsprechende Farbe aus der neu gewählten Palette – die Zuordnung Person↔Farbe bleibt dadurch beim Umschalten stabil und nachvollziehbar.
- Zuweisung ist **niemals zufällig und niemals alphabetisch** – ausschließlich fortlaufend nach freiem Slot in fester Reihenfolge.
- Bei **mehr als 12 gleichzeitig aktiven Assistenzkräften** (aktuell nicht der Fall, aber zukunftssicher einplanen): Slot 13 wird nicht durch eine neu erfundene Farbe belegt, sondern es beginnt eine zweite Runde ab Slot 1 mit einer zusätzlichen visuellen Unterscheidung (z. B. dünner Rahmen oder kleines Muster an der Pille), damit keine zwei aktiven Personen exakt dieselbe Farbe ohne jede weitere Kennzeichnung tragen. Die Kürzel-Beschriftung (siehe Punkt 2.1) bleibt in jedem Fall die primäre Unterscheidungshilfe, Farbe ist immer nur unterstützend.
- Farben aus 7.1/7.2 dürfen sich nicht mit den reservierten Statusfarben aus Punkt 6 (Urlaub-Gelb, Krankheit-Rot) verwechseln lassen; im Zweifel per Kürzel/Initialen (Punkt 2.1) zusätzlich absichern.

## Akzeptanzkriterien

- [ ] Kompakte, vollständige Monatsansicht erscheint erst, sobald die Menüleiste „Dienstplan" beim Scrollen sticky einrastet (wie in den Referenz-Screenshots)
- [ ] Menüleiste „Dienstplan" bleibt beim Scrollen oben sticky
- [ ] Wochentags-Kopfzeile bleibt beim Scrollen oben sticky (unter der Menüleiste)
- [ ] Datumszahl und Diensteinträge in Größe vergleichbar mit Assistenz Connect
- [ ] Leere Zelle zeigt „+"-Symbol, Klick öffnet direkt den Planungsdialog
- [ ] Zelle mit vorhandenen Einträgen zeigt zusätzliches „+" für weiteren Dienst
- [ ] Bei 1–2 Einträgen pro Tag bleibt die gesamte Monatsansicht weiterhin scrollfrei im sichtbaren Bereich
- [ ] Erst ab 3 Einträgen (inkl. Abwesenheits-Balken) darf die Ansicht nach unten wachsen/scrollen
- [ ] Doppelklick-Mehrfachauswahl funktioniert weiterhin unverändert
- [ ] Bestehender Zwei-Klick-Workflow (Markieren → Öffnen) bleibt für Zellen mit vorhandenen Einträgen erhalten
- [ ] UI-Chrome (Leiste, Hintergründe, Buttons) folgt AssistenzTreff-Markenpalette, optisch klar unterscheidbar von Assistenz Connect
- [ ] Beide 12er-Assistenzkräfte-Paletten (Hell 7.1, Dunkel-Golden-Winkel 7.2) sind exakt mit den angegebenen Hex-Werten hinterlegt, unabhängig von der Markenpalette
- [ ] Einstellungen-Umschalter zwischen heller und dunkler Palette vorhanden, wirkt global auf alle Pillen (Hintergrund + Textfarbe wechseln gemeinsam)
- [ ] Zuordnung Assistenzkraft↔Slot bleibt beim Umschalten der Palette stabil (Slot-Nummer entscheidet, nicht Hex-Wert)
- [ ] Neue Assistenzkräfte werden fortlaufend nach freiem Slot in der festen, optimierten Reihenfolge angelegt (nie zufällig/alphabetisch)
- [ ] Initialen + Uhrzeit von–bis in der Pille in größtmöglicher Schriftgröße mit leichtem Innenabstand zum Pillenrand (Punkt 2.1)
- [ ] Urlaub-/Krankheits-Statusfarben (Gelb/Rot) bleiben reserviert und werden nicht für Assistenzkräfte-Zuordnung wiederverwendet
