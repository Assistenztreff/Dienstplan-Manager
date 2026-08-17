---
name: Smartphone-Pille Breiten-Budget
description: Warum die einzeilige Smartphone-Kalender-Pille kein separates Namensfeld mehr hat, nur den Avatar-Kreis mit Initialen.
---

Die smartphone/`collapsed`-Pille in `dienstplan.tsx` (MonthGrid) ist nur ~48px
breit (Zelle ~57px minus Ränder). Diese Breite muss den linken Personen-Balken
(4px), den rechten Status-Balken (4px), den 19×19px-Avatar-Kreis (Pflicht auf
allen drei Pillen-Varianten) UND bis zu drei 12px-Status-Icons gleichzeitig
tragen.

**Warum:** Reale Messung (Playwright-Skript gegen den laufenden Dev-Server,
nicht nur Theorie) zeigte: sobald zusätzlich ein Namensfeld (egal ob Initialen
oder Nachname) neben Avatar + Icon(s) im Flex-Layout steht, kollabiert das
Namensfeld auf `clientWidth: 0` — der Browser gibt dem `flex-1 min-w-0`-Element
keinen Platz mehr, weil die `shrink-0`-Geschwister (Avatar+Icons+Paddings)
bereits die volle Breite beanspruchen. Das passiert unabhängig von der
Namenslänge, nicht nur bei langen Nachnamen.

**Entscheidung (17.08.2026, User-bestätigt):** Kein separates Namensfeld mehr
in der Smartphone-Pille. Die Avatar-Initialen sind dort die einzige
Personen-Kennung; der volle Name bleibt im `title`-Attribut der Pille. Die
zweizeilige Vollpille und die Minimiert-Variante haben spürbar mehr Breite
(min. 114–215px+ via Container-Queries) und behalten ihr Namensfeld.

**Wie anwenden:** Bevor an dieser Pille weitere Pflichtelemente (neue Icons,
Badges, Text) ergänzt werden, immer mit einer echten Breitenmessung (Playwright
`boundingBox()`/`scrollWidth` vs. `clientWidth` gegen den laufenden Dev-Server)
prüfen, ob das 48px-Budget das überhaupt hergibt — nicht nur anhand von
Code-Kommentaren/Annahmen kalkulieren.
