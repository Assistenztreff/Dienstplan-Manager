---
name: Die automatische Planung verteilt nach Monats-Soll, nicht reihum
description: Warum der Planungslauf freie Vertragsstunden braucht — und was passiert, wenn sie fehlen
---

Kay-Fehlermeldung 03.09.2026: Reines Reihum gab jeder Person gleich viele
Dienste. Eine Aushilfe mit rund 24 Vertragsstunden im Monat bekam damit 96 h
(+72), die Vollzeitkraefte blieben zweistellig im Minus. Kays Vorgabe: „Jeder
soll sein Monats-Soll erfuellen, Abweichung hoechstens plus/minus eine
Schicht."

**Wenn alle ihr Soll haben, der Monat aber noch Luecken hat** (Kay-Regel
03.09.2026, „Schwankende Monatsstunden sind in der Assistenz üblich"): Der
Platz bleibt trotzdem nicht leer. Greift der normale Weg nicht, waehlt der
Ersatzweg — erst Teilzeitkraefte, dann Vollzeitkraefte (ab `VOLLZEIT_STUNDEN`
= 168 h Soll), zuletzt Personen ohne hinterlegte Vertragsstunden; innerhalb
einer Stufe bekommt ihn, wer am wenigsten drueber liegt.

Der Unterschied, auf den es dabei ankommt: „hat schon genug" ist ein Grund
zurueckzustehen, „kann an dem Tag nicht" (abwesend, schon eingeteilt,
Ruhezeit) ist ein Ausschluss — auch im Ersatzweg. Sonst waere die Ruhezeit nur
noch eine Empfehlung. `soll_erfuellt` und `keine_vertragsstunden` sind seitdem
praktisch keine Gruende mehr, warum ein Platz offen bleibt.

**Wie es jetzt entscheidet.** `planeMonat` bekommt `freieStunden` — je Person
die noch offenen Vertragsstunden des Monats. Von allen, die den Platz
uebernehmen KOENNEN, bekommt ihn die Person mit dem groessten Rest. Die
Reihenfolge der Personenliste ist nur noch Gleichstandsregel; bei gleichen
Vertraegen ergibt sich damit exakt das alte Reihum. Wer bei ≤ 0 steht, wird
uebersprungen (`soll_erfuellt`); wer noch etwas braucht, darf den ganzen
Dienst nehmen, auch wenn er damit drueber rutscht — das ist die „eine Schicht
Toleranz".

**Woher die Zahl kommt.** `starteAutomatik` in `dienstplan.tsx` ruft
`berechneStundenkontoEintraege(...)` — dieselbe Rechnung, die im Stundenkonto
neben dem Raster steht, inklusive Entwuerfen und bezahlter Abwesenheiten
(Urlaub, Krank, vom Arbeitgeber abgesagt). Deshalb erklaert sich jede
Entscheidung des Laufs mit Zahlen, die der Planer ohnehin sieht. Keine zweite
Rechnung aufmachen.

**Aber im Lauf selbst rechnen, nicht aus dem Memo lesen** (Kay-Fehlermeldung
05.09.2026: „Nach jedem zweiten Entwurf bekommt Neubert keine Stunden, Timo
und Oliver weit ueber Soll"). „Neuer Entwurf" loescht erst die alten
Entwuerfe und plant dann — in EINEM Ablauf, React rendert dazwischen nicht.
Ein `useMemo` aus dem letzten Render meldete deshalb noch die Stunden der
gerade geloeschten Entwuerfe als verbraucht: alle galten als `soll_erfuellt`,
der Ersatzweg verteilte reihum an Teilzeit, dann an die Aushilfen (Gegenprobe
im E2E: Timo 96 h bei 23,8 h Soll), und die Vollzeitkraft ganz hinten ging
leer aus. Der Lauf rechnet die Konten jetzt aus `basis`, dem Stand nach dem
Abraeumen. Gleiche Falle wie `allShiftsRef` — alles, was der Lauf nach dem
Abraeumen braucht, muss aus `basis` kommen, nicht aus dem Render.

**Beim Messen im E2E:** `plannedHours` aus `/api/dashboard/hours-balance`
zaehlt NUR bestaetigte Dienste. Die Automatik legt Entwuerfe an — wer damit
misst, sieht ueberall 0 h und ein „niemand ueber Soll" ist immer wahr. Die
Spec summiert deshalb die Dauer der Schichten aus `/api/shifts` selbst.

**Zwei Sonderfaelle, die bewusst so sind.**
- Hat NIEMAND Vertragsstunden, gibt es keinen Bedarf — dann gilt weiter reines
  Reihum (`Stundenbedarf.aktiv === false`).
- Haben andere Vertragsstunden, diese Person aber nicht, bleibt sie aussen vor
  (`keine_vertragsstunden`): Ihr Bedarf ist unbekannt, und den Vertragsleuten
  Stunden wegzunehmen waere falsch. Ein Platz bleibt dann lieber offen.

**Abwesenheiten wirken zweifach.** Die Tages-Map (`abwesend`) sperrt den
Kalendertag. Zusaetzlich braucht der Lauf `sperrzeiten` — die Abwesenheit als
ZEITFENSTER. Ohne sie laeuft ein 24-Stunden-Dienst vom Vortag bis 09:00 in den
Urlaubstag hinein, und niemand merkt es: Die Ruhezeit greift nur zwischen
Arbeitsdiensten. Auf Sperrzeiten gilt bewusst KEINE Ruhezeit — wer am Tag nach
dem Urlaub um 9 Uhr anfaengt, hatte frei genug.

**Der 24-Stunden-Dienst und die Ruhezeit.** 09:00–09:00 heisst: der naechste
Dienst beginnt in derselben Sekunde, in der der vorige endet. Zwischen zwei
aufeinanderfolgenden Tagen liegen also NULL Stunden Ruhezeit. Eine Person kann
diesen Dienst darum nur jeden zweiten Tag uebernehmen (ausser innerhalb eines
Blocks, der von der Ruhezeit ausgenommen ist). Wer einen Test schreibt, in dem
eine einzelne Person einen 24-Stunden-Monat fuellen soll, stolpert genau
darueber.

**Sammel-Anlage: ein Konflikt darf nicht den ganzen Monat kosten.** Die Route
legt bei einer Ueberschneidung GAR NICHTS an. Da der Client einen Auftrag je
Person schickt, verschwand damit die komplette Monatsplanung dieser Person —
das waren Kays unbesetzte Tage. `starteAutomatik` fasst deshalb genau einmal
nach: Die vom Server in `conflictDates` benannten Tage (UTC-Startdatum!)
fliegen raus, der Rest wird angelegt und im Hinweis als „uebersprungen"
gemeldet. Ein zweiter Konflikt haette eine andere Ursache und wird gemeldet,
nicht wegprobiert.

## Nachtrag 03.09.2026: Warum eine Person voellig leer ausging

Kahraman hatte 167 h Soll und bekam 0 h; sieben Tage blieben offen. Der
Rechenkern war NICHT schuld — mit denselben Zahlen nachgestellt verteilt er
sauber (Test „Kays Monat vom 03.09.2026"). Es scheiterte am Speichern.

Die Route prueft die vorgemerkten Vertretungen MONATSWEIT und ueber alle Tage
des Auftrags hinweg (`geprueft.some(...)`): Ist EINE Vormerkung kein
Teammitglied mehr oder inzwischen Koordinatorin, antwortet sie 403 und legt
gar nichts an. Da der Client einen Auftrag je Person schickt, kostet das den
kompletten Monat dieser Person — im Raster stehen dann Luecken, deren Grund
niemand sieht.

`starteAutomatik` hat deshalb ZWEI Rettungsleinen, in dieser Reihenfolge:
1. 409 `shift_overlap` → die in `conflictDates` genannten Tage (UTC-Startdatum)
   weglassen, den Rest anlegen.
2. Jeder andere Fehler, sofern der Auftrag Vormerkungen enthielt → denselben
   Auftrag noch einmal OHNE `standbyUserId` schicken. Die Dienste sind
   wichtiger als die Vormerkung; sie laesst sich danach von Hand setzen.
Erst danach gilt der Auftrag als gescheitert. Der Fehlerhinweis bleibt seitdem
stehen (`duration: Infinity`) — ein Hinweis, der nach vier Sekunden
verschwindet, erklaert die Luecken im Raster niemandem.

Gegengeprobt: Ohne Rettungsleine 2 verlieren sechs von sieben Personen ihren
ganzen Monat — genau Kays Symptom.

## Die vorgemerkte Vertretung: zweite Fassung (Kay, 03.09.2026 nachmittags)

**Die Regel unten wurde ersetzt — sie steht hier nur noch als Begruendung.**
Kay will, dass JEDER Vertretungsplatz besetzt wird, solange ueberhaupt jemand
kann. Die Reihenfolge:
1. Wer im Monat noch gar keine Vertretung hat, kommt zuerst.
2. Haben alle eine, geht die zweite an die Teilzeitkraefte.
3. Erst danach an die Vollzeitkraefte (ab `VOLLZEIT_STUNDEN` = 168 h Soll).
Innerhalb einer Stufe entscheidet die Rotationsreihenfolge; Abwesenheit,
Belegung und Ruhezeit gelten unveraendert.

Dafuer bekommt `planeMonat` zusaetzlich `monatsSollStunden` (aus
`contractTarget` des Stundenkontos). Ohne hinterlegtes Soll gilt niemand als
Vollzeit — dann entscheidet allein die Zahl der bisherigen Vormerkungen.

## Verworfen: die vorgemerkte Vertretung folgt dem Vertrag

Vorgemerkt wird nur, wessen Vertrag den Dienst noch traegt
(`Stundenbedarf.traegtNoch`), und unter diesen die Person mit den WENIGSTEN
bisherigen Vormerkungen. Vorher nahm die Schleife immer die erste freie Person
ab dem Rotationszeiger — die Vormerkung landete dutzendfach bei denselben zwei
Aushilfen, ausgerechnet bei denen, deren Monat nach einem einzigen Dienst voll
ist.

Der Grund ist nicht nur Fairness: Wer vorgemerkt ist, wird im Ernstfall geholt.
Bei einem Minijob waere das schnell die Verdoppelung des Monatsverdienstes.
Zulaessig ist so etwas nur als UNVORHERGESEHENES Ueberschreiten (§ 8 Abs. 1b
SGB IV, hoechstens zwei Kalendermonate im Zwoelfmonatszeitraum, je hoechstens
das Doppelte der Grenze) — eine im Voraus eingeplante Vormerkung ist genau das
nicht mehr. Traegt kein Vertrag den Dienst, bleibt die Vormerkung leer.


## Nachtrag: „Die alten Entwuerfe liessen sich nicht abraeumen"

`letzterLaufIds` merkt sich die IDs des letzten Laufs fuer „Neu wuerfeln".
Zwei Loecher darin haben Kay am 03.09.2026 den Lauf abbrechen lassen:

1. Die IDs ueberlebten den MONATSWECHSEL. `goToMonth` leert sie jetzt — sonst
   loescht das Wuerfeln im November die Entwuerfe des Oktobers.
2. Waren einzelne davon inzwischen anderweitig geloescht, antwortete
   `bulk-delete` mit 404 (die Route loescht ganz oder gar nicht), und der Lauf
   brach ab, ohne irgendetwas zu planen. Jetzt wird vorher gegen die geladenen
   Schichten gefiltert, in Bloecken zu 200 geloescht, und ein Fehlschlag ist
   nur noch eine Warnung: Der Lauf fuellt dann die offenen Plaetze.

Merksatz fuer jede gemerkte ID-Liste im Dienstplan: Sie gilt nur fuer den
angezeigten Monat und nur, solange die Zeilen existieren. Vor dem Loeschen
gegen `allShifts` filtern.

## Nachtrag 2: Kein Knopf in einem Hinweis, der verschwindet

Kay-Fehlermeldung 03.09.2026 (spaeter Nachmittag): Nach dem ersten Lauf brachte
„Neu würfeln" die Meldung „0 Dienste angelegt, für 6 Personen nicht:
Überschneidung mit bestehenden Diensten an 8 Tagen".

Der Grund ist ein Klassiker: Der Knopf im Toast rief eine EINGEFRORENE Fassung
von `starteAutomatik` auf — die aus dem Moment, in dem der Toast entstand, also
mit dem `allShifts`-Stand von VOR dem Lauf. Die frisch angelegten Entwuerfe
standen dort nicht drin. Der Filter „nur loeschen, was es noch gibt" fand
deshalb nichts, es wurde nichts abgeraeumt, und der neue Lauf kollidierte mit
jedem einzelnen Dienst des alten.

Zwei Konsequenzen:

1. `allShiftsRef` haelt den aktuellen Schichtstand. `starteAutomatik` liest
   ausschliesslich daraus, nie aus der `allShifts`-Variablen des Renders. Wer
   hier eine Funktion aus einem Toast, einem Timer oder einem Event-Handler
   aufruft, bekommt sonst den Stand von damals.
2. Der Hinweis traegt gar keine Knoepfe mehr (Kay-Auftrag): Ein Knopf, der nach
   acht Sekunden verschwindet, ist ohnehin kein guter Ort fuer eine Aktion.
   Das Wuerfeln sitzt jetzt im Knopf der Leiste, der zwei Zustaende hat:
   „Entwurf erstellen" -> `starteAutomatik(true)` (nur Luecken fuellen),
   „Neuer Entwurf"     -> `starteAutomatik(false)` (abraeumen und neu wuerfeln).
   Umgeschaltet wird ueber `hatEntwurf`, gesetzt nach jedem erfolgreichen Lauf
   und geleert beim Monatswechsel.

Mit dem Wegfall des Toasts ist auch „Rueckgaengig" verschwunden. Ersatz ist der
Auswahlmodus: alles auswaehlen, Muelleimer.

**„Neuer Entwurf" mischt** (Kay-Auftrag 05.09.2026: „erscheint exakt noch
mal derselbe Dienstplan"). `planeMonat` ist ohne `zufall` vollstaendig
vorhersagbar — gut fuer Tests, schlecht fuer den Knopf. `dienstplan.tsx` gibt
`zufall: Math.random` mit. Gemischt wird nur, wo es das Soll nicht kostet:
unter allen, die koennen und hoechstens eine Schicht weniger brauchen als der
Spitzenreiter, entscheidet der Zufall; ausserdem startet jede Rotation an
zufaelliger Stelle. Tests bleiben deterministisch, weil sie `zufall`
weglassen oder einen Seed (mulberry32) mitgeben.
