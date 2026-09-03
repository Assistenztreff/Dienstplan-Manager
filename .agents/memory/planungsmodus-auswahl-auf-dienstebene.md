---
name: Im Planungsmodus wird auf DIENST-Ebene ausgewaehlt, nicht auf Tages-Ebene
description: Zwei Auswahlmechaniken im Dienstplan, warum es zwei sind und wie sie sich unterscheiden
---

Der Dienstplan hat seit dem 03.09.2026 ZWEI Auswahlmechaniken. Sie sehen
aehnlich aus, meinen aber Verschiedenes — wer das verwechselt, baut die eine in
die andere hinein.

**1. Mehrtagesauswahl** (`isSelectionMode` / `selectedDates`, Datumsschluessel
"yyyy-MM-dd"). Waehlt ganze TAGE. Gehoert zum Eintragen und Aendern: Die
Aktionsleiste unten bietet „Schichten eintragen", „Einträge ändern" und
Loeschen ueber `BulkDeleteDialog` (dort mit Personenfilter). Erreichbar ueber
den Kopfzeilen-Knopf, unabhaengig vom Planungsmodus.

**2. Dienstauswahl** (`dienstAuswahlModus` / `dienstAuswahl`, Schicht-IDs). Nur
im Planungsmodus. Waehlt EINZELNE Dienste. Gehoert zum Abraeumen.

## Kays Weg 1 (03.09.2026)

Ausgewaehlt wird durch einen Klick auf die Pille selbst. Die Pille bekommt
einen Rahmen (`ring-inset`, damit ihn kein `overflow: clip` der Zelle
abschneidet) und ihr Avatar-Kreis wird zum Haken. Bewusst KEIN zusaetzliches
Kaestchen und KEIN Muelleimer in der Pille: Auf dem Smartphone ist sie rund
48 px breit, dort ist fuer ein weiteres Bedienelement kein Platz (s.
`smartphone-pill-width-budget`) — und es haelt Abstand zu fremden Oberflaechen,
die genau das tun.

Der Auswahl-Knopf der Leiste waehlt mit EINEM Druck alle Dienste des Monats;
danach klickt man die wenigen Pillen ab, die bleiben sollen. Das ist der
haeufigere Weg: „fast alles weg" statt „ein paar einzelne weg". Ein Klick auf
die freie Flaeche einer Zelle schaltet alle Dienste dieses Tages um.

## Beim Aendern beachten

- `chipClickable` (Dialog oeffnen bzw. Person weiterdrehen) und `chipWaehlbar`
  (auswaehlen) schliessen sich gegenseitig aus. Beide muessen in ALLEN DREI
  Pillen-Varianten von `month-grid.tsx` gesetzt sein: Smartphone (`collapsed`),
  Desktop minimiert und Desktop voll. Die beiden Desktop-Varianten teilen sich
  `commonHandlers`, die Smartphone-Variante hat eigene Handler.
- Vorlaeufige Zeilen (`istVorlaeufig`, negative temp-ID) sind nicht
  auswaehlbar: Sie haben serverseitig noch keine ID und liessen sich nicht
  loeschen.
- Auswaehlbar sind nur eigene Arbeits- und Team-Eintraege. Abwesenheiten
  bleiben aussen vor — sie gehoeren nicht in den Planungsmodus; Spiegel-
  Eintraege fremder Teams sind ohnehin schreibgeschuetzt.
- Das Loeschen laeuft optimistisch (erst aus dem Cache, dann `bulk-delete` in
  Bloecken zu 200). Schlaegt ein Block fehl, werden die Zeilen sofort wieder
  eingesetzt — sonst steht der Planer vor einem leeren Raster.
- Beim Verlassen des Planungsmodus BEIDE Auswahlen abraeumen. Eine unsichtbar
  weiterlaufende Auswahl ist eine Falle.

## Icons im Auswahlmodus (Kay, 03.09.2026 nachmittags)

Kay sah zwei gruene Haken nebeneinander und hielt sie fuer denselben Zustand.
Sie bedeuten Verschiedenes, also sehen sie jetzt verschieden aus:

- **Links, statt des Avatars:** ein ECKIGES dunkelblaues Feld mit Haken
  (`PillAvatar` mit `ausgewaehlt`) = „von mir ausgewaehlt".
- **Rechts, wo sonst das Status-Icon sitzt:** ein gruener RUNDER Haken =
  „vom Planer bestaetigt".

An einer ausgewaehlten Pille verschwindet das Status-Icon ganz und der rote
Muelleimer (`PillMuelleimer`) tritt an seine Stelle — er loescht genau diesen
einen Dienst. Der Status ist in dem Moment die unwichtigste Information.

Beide Zeichen sind mit 20 px etwas groesser als das Status-Icon (13 px im
Kalender): Das Auswahlfeld, damit die Auswahl beim Ueberfliegen des Monats
auffaellt; der Muelleimer, weil er ein Bedienelement ist und auf dem
Smartphone getroffen werden muss.

Beides ist in ALLEN DREI Pillen-Varianten von `month-grid.tsx` verdrahtet
(Smartphone, Desktop minimiert, Desktop voll) — die beiden Desktop-Varianten
teilen sich `statusBadgeStack`, die Smartphone-Variante hat ihren eigenen.

## Bestaetigen aus der Auswahl heraus

Der Haken-Knopf der Leiste setzt die ausgewaehlten Entwuerfe auf FIX. Bewusst
je Dienst ein PATCH statt einer neuen Sammelroute: `POST /shifts/bulk-confirm`
bestaetigt nur ANGEBOTENE eines ganzen Monats, hier geht es um eine freie
Auswahl, die auch Entwuerfe enthaelt. Die Requests laufen parallel und das
Raster zeigt das Ergebnis sofort — es bleibt bei einer Wartezeit. Der Knopf
erscheint nur, wenn die Auswahl ueberhaupt Entwuerfe enthaelt.
