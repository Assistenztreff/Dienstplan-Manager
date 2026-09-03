---
name: Die automatische Planung verteilt nach Monats-Soll, nicht reihum
description: Warum der Planungslauf freie Vertragsstunden braucht — und was passiert, wenn sie fehlen
---

Kay-Fehlermeldung 03.09.2026: Reines Reihum gab jeder Person gleich viele
Dienste. Eine Aushilfe mit rund 24 Vertragsstunden im Monat bekam damit 96 h
(+72), die Vollzeitkraefte blieben zweistellig im Minus. Kays Vorgabe: „Jeder
soll sein Monats-Soll erfuellen, Abweichung hoechstens plus/minus eine
Schicht."

**Wie es jetzt entscheidet.** `planeMonat` bekommt `freieStunden` — je Person
die noch offenen Vertragsstunden des Monats. Von allen, die den Platz
uebernehmen KOENNEN, bekommt ihn die Person mit dem groessten Rest. Die
Reihenfolge der Personenliste ist nur noch Gleichstandsregel; bei gleichen
Vertraegen ergibt sich damit exakt das alte Reihum. Wer bei ≤ 0 steht, wird
uebersprungen (`soll_erfuellt`); wer noch etwas braucht, darf den ganzen
Dienst nehmen, auch wenn er damit drueber rutscht — das ist die „eine Schicht
Toleranz".

**Woher die Zahl kommt.** `freieStundenByUserId` in `dienstplan.tsx` liest
`useStundenkontoEintraege(...).frei` — dieselbe Rechnung, die im Stundenkonto
neben dem Raster steht, inklusive Entwuerfen und bezahlter Abwesenheiten
(Urlaub, Krank, vom Arbeitgeber abgesagt). Deshalb erklaert sich jede
Entscheidung des Laufs mit Zahlen, die der Planer ohnehin sieht. Keine zweite
Rechnung aufmachen.

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

## Die vorgemerkte Vertretung folgt dem Vertrag

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
