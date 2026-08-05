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
- **Datumszahl** in jeder Zelle: oben links positioniert, mit **grauem, leicht abgerundetem Rechteck** als Hintergrund (statt frei stehender Zahl wie aktuell). Schriftgröße ungefähr wie bei Assistenz Connect (deutlich kleiner als aktuell).
- **Zellenkopf-Regel (bestätigt 04.08.2026):** In jeder Tageszelle steht die Datumszahl **links**, das „+"-Symbol (siehe Punkt 4) **rechts daneben** in derselben Kopfzeile der Zelle – gilt für leere wie gefüllte Zellen, Desktop/Tablet/Smartphone gleichermaßen, auch im aufgeklappten Smartphone-Zustand (Punkt 2.4). Referenz-Mockups: `dienstplan-kalender-gesamtmockup.html`, `smartphone-aufklappen-v3-vollstaendig.html`.
- **Pillen-/Diensteinträge**: Darstellung als kompakte, zweizeilige "Pille" – Aufbau siehe Punkt 2.1.

### 2.1 Aufbau der Pille (FINAL, Stand 03.08.2026 – ersetzt alle früheren Versionen)

Referenz-Mockup: `dienstplan-pille-final.html`. Die Pille ist **zweizeilig** und wie folgt aufgebaut:

- **Farbbalken links, ca. 3 px breit (Spielraum 2–4 px)**, durchgehend **über beide Zeilen auf voller Pillenhöhe** am linken Rand: einzige Stelle, an der die Assistenzkraft-Farbe aus Punkt 7 (7.1 Hell/7.2 Dunkel) erscheint. Die Pille selbst ist **nicht** mehr vollflächig eingefärbt.
- **Zeile 1 (Namenszeile):** Hintergrund **Weiß `#ffffff`**, Text = **nur der Nachname** der Assistenzkraft (fett, dunkel, z. B. `#151515`). Rechtsbündig in dieser Zeile sitzt das **Status-Icon** (siehe Tabelle unten).
- **Zeile 2 (Zeitzeile):** Hintergrund **leicht dunkleres Grauweiß `#f1f1ee`**, Inhalt = kleines Uhr-Icon (unverändert wie bisher) + Uhrzeit von–bis (regular, z. B. `#444444`).
- Die zwei leicht unterschiedlichen Grauweißtöne der Zeilen dienen der optischen Trennung und der besseren Erkennbarkeit der Icons.
- Abgerundete Ecken (ca. 6 px), feiner Rahmen (`#e6e6e2`), kompakte Schriftgröße (~11–12 px), Innenabstand ~4 px vertikal / 8–9 px horizontal.

**Status-Icons (rechts in der Namenszeile; Status niemals nur über Farbe kommunizieren):**

| Icon | Bedeutung | Farbe |
|---|---|---|
| Stift | Entwurf (noch nicht freigegeben, nur Verwaltung sichtbar) | `#b5790a` |
| Grüner Haken | Bestätigt (Fix) | `#1e8f4e` |
| Opulentes Warn-Badge (gefüllter Kreis mit Halo, siehe unten) | Bewusste Übersteuerung einer Abwesenheits-Warnung | `#c23b34` |
| Uhr (in Zeile 2) | geplante Dienstzeit, immer sichtbar | neutral `#444444` |

**Wichtig – kein dritter gleichrangiger Status:** Das Warn-Icon ist **kein** eigenständiger dritter Pillen-Status neben Entwurf/Bestätigt. Es erscheint **ausschließlich**, wenn der Assistenznehmer im Dienst-Dialog eine als abwesend markierte, ausgegraute Assistenzkraft trotz Inline-Warnung bewusst bestätigt hat (siehe „Abwesenheiten organisieren" unten). Weil das eine bewusste Entscheidung war, die später (z. B. bei der Lohnprüfung) nicht übersehen werden darf, wird sie **auffälliger** dargestellt als Stift/Haken: gefüllter Kreis mit hellem Halo (`box-shadow: 0 0 0 2px #fff, 0 0 0 3px #f3c9c5`) statt dünnem Umriss. Zusätzlich ergänzt die Zeitzeile einen kurzen Klartext-Hinweis (z. B. „19:00–09:00 · trotz Urlaub geplant") – Status wird nie nur über Icon/Farbe allein kommuniziert. Referenz-Mockup: `pille-warnung-vertretung.html`.

**Vertretungs-Icon (Stand 03.08.2026, Position korrigiert):**

Wird eine ausgefallene Schicht (z. B. durch Krankheit) von einer anderen Assistenzkraft übernommen, erhält **deren** Pille ein Vertretungs-Icon (zwei entgegengesetzt kreisende Pfeile, Farbe `#0f6e8c`) – **rechts neben der Uhrzeit in Zeile 2**, nicht als separates Badge unterhalb der Pille. Bei ausreichender Breite (Desktop) erscheint zusätzlich das Textlabel „Vertretung"; wird die Pille schmaler (Tablet, kleinere Kalenderzellen), reduziert sich die Anzeige automatisch auf das reine Icon (Text fällt weg, Icon bleibt). Referenz-Mockup: `pille-responsive.html`.

**Retro-Bearbeitung (nachträglich als „Krank" markieren):** Wird eine Assistenzkraft im Nachhinein krank (z. B. nach bereits abgegebenen Lohndaten), wird der betroffene, bereits bestätigte Dienst nachträglich auf Status „Krank" umgestellt. Kein neues Icon nötig – dies nutzt denselben Mechanismus, der im bestehenden AssistenzPlaner-Handbuch für den Monatsabschluss bereits dokumentiert ist (Änderungen nach Abschluss lösen einen „Nachberechnung"-Hinweis im Folgemonat aus).

### 2.2 Responsive Verhalten der Pille (Desktop / Tablet / Smartphone)

Referenz-Mockups: `pille-responsive.html`, `smartphone-aufklappen-v3-vollstaendig.html`. **Grundprinzip (Stand 03.08.2026, korrigiert): Es gibt nur EINE Pillen-Definition** (Farbbalken volle Höhe über beide Zeilen, Zeile 1 Name + Status-Icon, Zeile 2 Uhr-Icon + Uhrzeit) gemäß Punkt 2.1 – sie sieht am Desktop, am Tablet und im aufgeklappten Smartphone-Zustand (siehe 2.4) **strukturell und optisch identisch** aus. Es gibt **kein** separates vereinfachtes Pillen-Format für kleine Screens. Was sich mit der Breite ändert, ist ausschließlich, **ob** die Pille angezeigt wird oder durch die minimalen Mini-Balken ersetzt wird:

| Breite / Zustand | Pillen-Darstellung | Vertretungs-Icon | Abwesenheiten in der Zelle |
|---|---|---|---|
| **Desktop** ≥ 900 px | Volle Pille (Punkt 2.1), unverändert | Icon + Text „Vertretung" | Dünner Balken pro Abwesenheit (siehe Punkt 8.1), Kategorietext sichtbar |
| **Tablet** 600–900 px | Dieselbe Pille, nur schmalere Spalten (Uhrzeit ggf. ohne zusätzliches Padding) | Nur Icon, kein Text (reine Platzfrage, Pille selbst unverändert) | Dünner Balken, Kategorietext nur im Tooltip/Tap |
| **Smartphone, zugeklappt** < 600 px (Standard) | **Keine Pillen im Monatsraster** – stattdessen ein farbiger Mini-Balken je zugeteilter Assistenzkraft (Assistenzkraft-Farbe, ca. 5 px hoch) plus Zähler „x Dienste"; Tap auf die Zelle **befüllt die bereits bestehende Tagesdetail-Liste unterhalb des Kalenders und scrollt automatisch dorthin** (kein neuer Screen/Modal), dort erscheint die volle, unveränderte Pille | Nur in der Tagesdetail-Liste sichtbar (mit Text) | Ein zusätzlicher dünner Streifen unterhalb der Mini-Balken in Kategoriefarbe (Gelb/Rot/Grau) |
| **Smartphone, aufgeklappt** < 600 px (siehe 2.4) | **Dieselbe volle Pille wie Desktop/Tablet**, gestapelt in den (dadurch höher werdenden) Zellen des Monatsrasters | Wie Tablet: Icon, Text je nach Platz | Dünner Balken wie Desktop |

Diese Staffelung ist eine bewusste Eigenentwicklung, nicht direkt von Assistenz Connect übernommen – lediglich das allgemeine Prinzip „auf kleinen Screens auf Indikatoren statt Volltext reduzieren" dient als Inspiration.

### 2.3 Smartphone: Umschalter „Monat" / „Liste" (Stand 03.08.2026)

Referenz-Mockup: `smartphone-listen-toggle.html`. Grund: Bei 7 Spalten auf Handybreite (~44 px pro Zelle) ist selbst ein kurzer Nachname nicht mehr lesbar in der Zelle darstellbar, ohne die Kompaktheit zu opfern. Statt Namen in die Zelle zu zwingen, bekommt die Smartphone-Ansicht einen **Segmented-Toggle** oben in der Subbar (neben dem Monatstitel):

- **„Monat" (Standard):** die in Punkt 2.2 beschriebene kompakte Rasteransicht mit Mini-Balken + Zähler (zugeklappter Zustand).
- **„Liste":** wandelt die Ansicht in eine durchscrollbare **Monats-Agenda** – jeder Tag mit Einträgen erscheint als eigene Zeile mit vollem Nachnamen (nicht nur Initialen), Uhrzeit und denselben Status-Icons wie überall sonst (Haken, Stift, opulentes Warn-Badge, Vertretungs-Icon). Tage ohne Einträge werden platzsparend als schmale Zeile „keine Einträge" dargestellt, nicht ausgeblendet.
- Die Auswahl (Monat/Liste) wird **pro Nutzer gemerkt** (gleiches Prinzip wie die bereits im eigenen Handbuch dokumentierte Filter-Erinnerung).
- Konzept-Anleihe bei Assistenz Connect (kompakte, einzeilige Darstellung pro Eintrag), aber als **zusätzliche** Ansicht neben dem Monatsraster – nicht als alleinige Ansicht wie bei AC.

### 2.4 Smartphone: Monatsraster auf-/zuklappen (Stand 03.08.2026)

Referenz-Mockup: `smartphone-aufklappen-v3-vollstaendig.html`. Zusätzlich zum Monat/Liste-Umschalter (2.3) gibt es innerhalb der Ansicht „Monat" einen eigenen **Auf-/Zuklapp-Button** (Chevron-Icon) in der Subbar:

- **Zugeklappt (Standard):** die minimale Mini-Balken-Ansicht aus Punkt 2.2.
- **Aufgeklappt:** Die Zellen wachsen, und pro Tag erscheinen die Dienste als **gestapelte, vollständige Pillen – exakt dieselbe Pillen-Definition wie am Desktop** (siehe Klarstellung in 2.2), nicht als eigenes vereinfachtes Format. So bekommt der Nutzer einen schnellen Überblick über den ganzen Monat und alle Dienste aller Assistenzkräfte, ohne einzelne Tage antippen zu müssen – ähnlich der Grundidee von Assistenz Connect (dort werden Diensteinträge pro Tag untereinander gestapelt), aber mit unserer eigenen, unveränderten Pille statt eines Nachbaus.
- Im aufgeklappten Zustand greift die Scroll-Regel aus Punkt 3 entsprechend früher, weil die Zellen von Haus aus höher sind – bewusster Kompromiss für den Volltext-Überblick.
- Zustand (auf-/zugeklappt) wird ebenfalls pro Nutzer gemerkt, unabhängig vom Monat/Liste-Umschalter aus 2.3.

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
- **Klickflächen im Mehrfachauswahl-Modus (Stand 03.08.2026):** Im Mehrfachauswahl-Modus muss der **gesamte Zellenkopf inklusive Datumszahl** als Auswahlfläche für den Tag dienen – **ausgenommen nur das „+"-Symbol**, das seine eigene Funktion behält. Diese Anforderung gilt gleichermaßen für die spätere Tabellenansicht (dort entsprechend: ganze Tages-/Zellenfläche wählbar außer expliziten Aktions-Buttons).

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

### 7.2 Dunkle Palette (12 Slots, für weiße Schrift)

Feste, geprüfte Werte, von Hand ausgewählt (bewusst **nur 1× Grünton** statt mehrerer ähnlicher Grün-/Oliv-Töne, die sich sonst zu ähnlich sehen) – Reihenfolge nach maximaler gegenseitiger Unterscheidbarkeit optimiert (Farthest-Point-Auswahl im Lab-Farbraum), Slot 1 zuerst vergeben.

| Slot | Farbname | Hex | Kontrast ggü. Weiß `#ffffff` |
|---|---|---|---|
| 1 | Gelbgrün | `#6c701a` | 5,29 : 1 |
| 2 | Indigo | `#552895` | 9,89 : 1 |
| 3 | Rot | `#5f1c21` | 12,54 : 1 |
| 4 | Petrol | `#216c73` | 6,07 : 1 |
| 5 | Magenta | `#852364` | 8,67 : 1 |
| 6 | Grün | `#1c5f38` | 7,65 : 1 |
| 7 | Orange | `#5f431c` | 9,11 : 1 |
| 8 | Blau | `#284395` | 9,02 : 1 |
| 9 | Himmelblau | `#204e6f` | 8,82 : 1 |
| 10 | Violett | `#4e1c5f` | 12,69 : 1 |
| 11 | Koralle | `#853c23` | 7,87 : 1 |
| 12 | Kobalt | `#27206f` | 13,79 : 1 |

Textfarbe für diese Palette: **Weiß `#ffffff`** (siehe Punkt 2.1 zur Größe). Alle 12 Werte liegen über dem WCAG-AA-Minimum von 4,5 : 1.

### 7.3 Einstellungen-Umschalter & Zuweisungslogik

- In den **Einstellungen** wählt der Nutzer aus, welche der beiden Paletten (7.1 „Hell" oder 7.2 „Dunkel – Golden-Winkel") aktuell verwendet wird. Die Auswahl gilt global für den gesamten Kalender (Text- und Hintergrundfarbe der Pillen wechseln gemeinsam, siehe Textfarbe pro Palette oben).
- **Zuordnung pro Assistenzkraft erfolgt über die Slot-Nummer, nicht über den Hex-Wert direkt:** Jede Assistenzkraft bekommt beim Anlegen fortlaufend den nächsten freien Slot (1, 2, 3, ...) zugewiesen – in der Reihenfolge aus 7.1 bzw. 7.2, je nachdem welche Palette gerade aktiv ist. Wechselt der Nutzer später die Palette in den Einstellungen, behält jede Assistenzkraft ihre Slot-Nummer und bekommt automatisch die entsprechende Farbe aus der neu gewählten Palette – die Zuordnung Person↔Farbe bleibt dadurch beim Umschalten stabil und nachvollziehbar.
- Zuweisung ist **niemals zufällig und niemals alphabetisch** – ausschließlich fortlaufend nach freiem Slot in fester Reihenfolge.
- Bei **mehr als 12 gleichzeitig aktiven Assistenzkräften** (aktuell nicht der Fall, aber zukunftssicher einplanen): Slot 13 wird nicht durch eine neu erfundene Farbe belegt, sondern es beginnt eine zweite Runde ab Slot 1 mit einer zusätzlichen visuellen Unterscheidung (z. B. dünner Rahmen oder kleines Muster an der Pille), damit keine zwei aktiven Personen exakt dieselbe Farbe ohne jede weitere Kennzeichnung tragen. Die Kürzel-Beschriftung (siehe Punkt 2.1) bleibt in jedem Fall die primäre Unterscheidungshilfe, Farbe ist immer nur unterstützend.
- Farben aus 7.1/7.2 dürfen sich nicht mit den reservierten Statusfarben aus Punkt 6 (Urlaub-Gelb, Krankheit-Rot) verwechseln lassen; im Zweifel per Kürzel/Initialen (Punkt 2.1) zusätzlich absichern.

## 8. Abwesenheiten organisieren (Stand 03.08.2026)

Referenz-Mockups: `abwesenheiten-konzept.html`, `assistenz-auswahl-icons.html`. Ziel: Die bisher 8 einzelnen Farbcodes im Kalender (Urlaub, Krank, Freizeitausgleich, Kind krank, Freistellung, Absage AG, Absage AK, Urlaubsabgeltung) sind unübersichtlich geworden. Neues Konzept in vier Teilen:

**8.1 Drei Kategoriefarben statt acht Einzelfarben im Kalender:** Die dünnen Abwesenheits-Balken im Monatskalender verwenden nur noch drei Kategoriefarben – **Gelb** = geplant (Urlaub, Freizeitausgleich, Freistellung, Urlaubsabgeltung), **Rot** = Ausfall (Krank, Kind krank), **Grau** = Absagen (AG/AK). Die konkrete Art steht zusätzlich als Text im Balken/Tooltip und in der Tagesdetail-Liste. Die Abrechnung (Auswertungen, Lohnexport) unterscheidet weiterhin alle 8 Arten unverändert – nur die Kalender-Darstellung wird vereinfacht.

**8.2 Eigene Icon-Familie statt reiner Farbpunkte** (bewusster Unterschied zu Assistenz Connect, das nur farbige Punkte/Chips als Legende nutzt): Jede der 8 Abwesenheitsarten bekommt ein eigenes, selbst entworfenes Icon (Form + Kategoriefarbe gemeinsam – barrierefreier als Farbe allein). „Wunsch frei" (Verfügbarkeits-Präferenz, **keine** echte Abwesenheit) bekommt eine vierte, eigene Farbe (Violett) und ein Stern-Icon – bleibt normal wählbar, ist keine Sperre.

**8.3 Drei Verteidigungslinien gegen Termin-Konflikte** (löst „weich blockieren, aber sofort warnen" statt hartem Verbot oder zu spätem Warnhinweis beim Speichern):
- **Linie 1 – Verhindern:** Im Dienst-Dialog ist die Assistenten-Auswahlliste die Quelle der Wahrheit. Abwesende Kräfte sind sichtbar und **bleiben wählbar** (kein Hard-Block), sind aber optisch abgesetzt (Icon + Abwesenheitsart als Text-Tag, siehe 8.2). Sobald eine so markierte Kraft ausgewählt wird, erscheint **sofort ein Inline-Warnhinweis** direkt unter dem Auswahlfeld (nicht erst beim Speichern), z. B. „Florian Thierer hat Urlaub bis 15.08. – trotzdem einplanen?". Gilt auch in der Mehrfachauswahl: Betroffene Tage werden übersprungen, mit Hinweis welche.
- **Linie 2 – Bewusste Übersteuerung sichtbar machen:** Bestätigt der Assistenznehmer die Warnung explizit („Ja, trotzdem planen"), erscheint in der resultierenden Pille das **opulente Warn-Badge** (siehe Punkt 2.1) – als Nachweis einer bewussten Entscheidung, nicht als genereller dritter Status.
- **Linie 3 – Nachträgliche Änderungen abfangen:** Wird eine Abwesenheit nachträglich für einen Zeitraum mit bestehenden Diensten eingetragen, zeigt der Speichern-Dialog die betroffenen Dienste an und bietet an: Dienste behalten (→ opulentes Warn-Badge) oder auf „Abgesagt" setzen.

**8.4 Synchronisation ist Pflicht (keine doppelte Datenhaltung):** Abwesenheiten müssen an **jeder** Stelle, an der sie angezeigt werden – Monatskalender-Balken, Assistenten-Auswahlliste im Dienst-Dialog, Tagesdetail-Liste unten und der eigenständige Tab „Abwesenheiten" – **immer aus derselben Datenquelle** stammen und in Echtzeit synchron sein. Eine Änderung an einer Stelle (z. B. Abwesenheit im Tab „Abwesenheiten" gelöscht) muss sich sofort überall auswirken (Kalender-Balken verschwindet, Assistenzkraft ist in der Auswahlliste wieder normal wählbar). Es gibt nur einen Datensatz pro Abwesenheit, keine Kopien.

**8.5 Tab „Abwesenheiten": Jahres-/Mehrmonatsansicht ergänzen.** Zusätzlich zur bestehenden Ansicht eine Kalenderansicht analog zu Assistenz Connect (Konzept-Anleihe, eigenes Design): Zeilen = Assistenzkräfte, Spalten = Tage über mehrere Monate/das Jahr, Zeitraum-Eintrag per Klick auf Start- und Endtag, Filter-Chips (nach den 3 Kategoriefarben aus 8.1) dienen gleichzeitig als Legende. Zweck: Urlaube, die Monate im Voraus liegen, ohne Umweg über den Dienstplan erfassen können.

## 9. Tagesdetail-Liste (schmale Bildschirme / Mobile-Ansicht)

Bleibt als Konzept erhalten (unterhalb des Monatskalenders, wie bereits in der App vorhanden), wird aber kompakter:

- Pro Diensteintrag **eine Zeile**: Name der Assistenzkraft, Uhrzeit von–bis und Dienstart nebeneinander in derselben Zeile (statt wie bisher mit viel Weißraum darunter).
- **„Bestätigen"-Button rechts daneben** in derselben Zeile – **nur anzeigen, wenn der Dienst noch nicht bestätigt ist**; bei bereits bestätigten Diensten entfällt der Button ersatzlos (kein Platzhalter).
- „+ Dienst anlegen"-Button oben in diesem Bereich bleibt erhalten.

> **Geklärt (03.08.2026):** Kein Overflow-Badge. Regel: Solange alle Tage mit ihren Einträgen in die scrollfreie Monatsansicht passen, bleibt der Monat vollständig sichtbar. Sobald einzelne Tage zu viele Einträge haben, **verlängert sich der Kalender nach unten und es muss gescrollt werden** (Sticky-Header bleiben oben fixiert). Vor der Umsetzung mit realistischen Testdaten (4–6 Assistenzkräfte an einem Tag) gegenprüfen.

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
- [ ] Monats-Pille zweizeilig gemäß Punkt 2.1: 2-px-Farbbalken links (Palettenfarbe), Zeile 1 = Nachname auf Weiß + Status-Icon rechts, Zeile 2 = Uhr-Icon + Uhrzeit auf Grauweiß `#f1f1ee`
- [ ] Status-Icons vorhanden: Stift = Entwurf, grüner Haken = bestätigt, Warndreieck = Konflikt – Status nie nur über Farbe
- [ ] Datumszahl oben links in der Zelle mit grauem, abgerundetem Rechteck als Hintergrund
- [ ] Zellenkopf zeigt Datum links und „+"-Symbol rechts daneben, in jeder Zelle und auf allen Breakpoints inkl. aufgeklapptem Smartphone (Punkt 2)
- [ ] Tagesdetail-Liste: Name, Uhrzeit, Dienstart in einer Zeile; „Bestätigen"-Button rechts daneben nur bei unbestätigten Diensten sichtbar
- [ ] Urlaub-/Krankheits-Statusfarben (Gelb/Rot) bleiben reserviert und werden nicht für Assistenzkräfte-Zuordnung wiederverwendet
- [ ] Abwesenheiten im Kalender nur noch in 3 Kategoriefarben (Gelb/Rot/Grau, Punkt 8.1), 8 Einzelarten unverändert in Abrechnung/Tooltip/Tagesdetail
- [ ] Eigene Icon-Familie pro Abwesenheitsart in der Assistenten-Auswahlliste vorhanden (Punkt 8.2), „Wunsch frei" optisch als Präferenz (nicht als Sperre) abgesetzt
- [ ] Abwesende Kraft in Auswahlliste bleibt wählbar (kein Hard-Block), Inline-Warnhinweis erscheint sofort bei Auswahl (Punkt 8.3, Linie 1)
- [ ] Opulentes Warn-Badge erscheint ausschließlich nach bewusster Bestätigung der Warnung, nicht als genereller dritter Pillen-Status (Punkt 8.3, Linie 2)
- [ ] Nachträgliche Abwesenheits-Eintragung über bestehende Dienste löst Dialog aus (Dienst behalten vs. auf „Abgesagt" setzen, Punkt 8.3, Linie 3)
- [ ] Abwesenheiten sind an allen vier Stellen (Kalender-Balken, Auswahlliste, Tagesdetail-Liste, Tab „Abwesenheiten") aus derselben Datenquelle synchron, keine Datenkopien (Punkt 8.4)
- [ ] Tab „Abwesenheiten" verfügt über Jahres-/Mehrmonatsansicht mit Zeitraum-Eintrag per Klick (Punkt 8.5)
- [ ] Vertretungs-Icon steht rechts neben der Uhrzeit (nicht als Badge unter der Pille), reduziert sich bei schmaler Breite auf reines Icon ohne Text (Punkt 2.1)
- [ ] Pille verhält sich responsiv gemäß Punkt 2.2: volle Pille ab 900 px, Icon-only-Vertretung 600–900 px, Mini-Balken statt Pillen unter 600 px im Monatsraster
- [ ] Smartphone-Ansicht bietet Segmented-Toggle „Monat"/„Liste" (Punkt 2.3); „Liste" zeigt vollen Nachnamen + Uhrzeit + Status-Icons pro Tag als scrollbare Monats-Agenda; Auswahl wird pro Nutzer gemerkt
- [ ] Es existiert nur EINE Pillen-Definition (Punkt 2.1), identisch auf Desktop, Tablet und aufgeklapptem Smartphone – keine separate vereinfachte Pillen-Variante für kleine Screens
- [ ] Smartphone-Ansicht „Monat" bietet zusätzlichen Auf-/Zuklapp-Button (Punkt 2.4); aufgeklappt zeigt das Monatsraster gestapelte, vollständige Pillen (identisch zur Desktop-Pille); zugeklappt bleiben die Mini-Balken; Zustand wird pro Nutzer gemerkt
