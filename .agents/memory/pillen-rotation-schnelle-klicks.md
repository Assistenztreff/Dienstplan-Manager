---
name: Pillen-Rotation im Planungsmodus vertraegt schnelle Klicks
description: Warum rotierePille einen Sender je Dienst hat und Antworten nur noch bei passendem Ziel uebernimmt
---

Kay-Fehlermeldung 05.09.2026: „Klickt man schnell auf eine Dienstpille,
erscheint zuerst die richtige Person, dann springt die Ansicht kurz zurueck
und zeigt nacheinander alle Assistenzkraefte bis zum letzten Klick."

Ursache: Jeder Klick schickte sofort seinen eigenen PUT und schrieb die
Antwort per `upsertShiftsInCache` ins Raster. Drei schnelle Klicks = drei
Antworten, und jede setzte kurz „ihren" Stand — in der Reihenfolge, in der
sie eintrafen.

Loesung in `rotierePille` (`dienstplan.tsx`): `rotationsLauf` (Ref, Map je
Dienst-ID) merkt sich nur das ZIEL und ob ein Sender laeuft. Ein Klick setzt
optimistisch das Raster, aktualisiert das Ziel und kehrt zurueck, wenn schon
gesendet wird; der laufende Sender schickt in einer Schleife immer nur den
juengsten Stand und uebernimmt eine Antwort nur, wenn sie noch dem Ziel
entspricht. Ausgangspunkt der naechsten Person ist ebenfalls das Ziel, nicht
`shift.userId` aus dem Render — sonst waehlt ein zweiter schneller Klick
zweimal dieselbe „naechste".

E2E-Gegenprobe (`dienstplan-planungsmodus.spec.ts`): per `page.route` trifft
die ERSTE Antwort spaeter ein als die zweite. Alter Code: Raster faellt auf
Ben zurueck, Server steht auf Clara. Neuer Code: beides Clara.
