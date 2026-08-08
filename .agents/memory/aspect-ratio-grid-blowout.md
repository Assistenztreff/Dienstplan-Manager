---
name: aspect-ratio auf Grid-Items bläht Spalten auf
description: CSS-Grid + aspect-ratio + align-self stretch überträgt die Inhaltshöhe als automatische Mindestbreite zurück auf die Spalte — Fix: min-w-0 auf dem Item
---

Bei einem Grid-Item mit `aspect-ratio` und `align-self: stretch` (Default) überträgt CSS die Inhalts-HÖHE über das Seitenverhältnis als automatische Mindest-BREITE auf die Spalte (Rückkopplung). Ergebnis im Dienstplan-Monatsraster: ALLE Spalten blähten sich auf 149px auf (statt ~52px bei 402px Viewport), das Grid überlief horizontal, und wegen aspect-ratio 1/1 wurden alle Zeilen ebenfalls 149px hoch.

**Why:** Die automatic minimum size eines Grid-Items greift nur bei `min-width: auto`; aspect-ratio + stretch aktiviert den Block→Inline-Transfer. Gelebter Bug in #710 (Arbeitspaket 07.08.2026, Punkt 4: quadratische Smartphone-Zellen, Wochenzeile wächst mit Inhalt).

**How to apply:**
- Item braucht `min-w-0` — das deaktiviert die automatische Mindestbreite und damit die Rückkopplung.
- NICHT `overflow: hidden` auf dem Item, wenn die Zeile mit Inhalt wachsen soll: overflow:hidden setzt die Block-Achsen-Mindesthöhe auf 0 und die Pillen werden geclippt (Zeile bleibt quadratisch, Inhalt abgeschnitten).
- AUCH NICHT `overflow-x: clip` als alleinige Lösung: clip erzeugt keinen Scroll-Container und unterdrückt die automatic minimum size NICHT — der Blowout bleibt.
- Kombination in `dienstplan.tsx` (Mobil-Zellen): `aspectRatio: "1 / 1"` + `overflowX: "clip"` (inline style) + `min-w-0` (Klasse); Desktop-Variante `full` behält `min-h-0 overflow-hidden`.
