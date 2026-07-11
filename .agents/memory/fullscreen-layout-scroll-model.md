---
name: Layout & Scroll-Modell
description: Das Dokument scrollt nie (h-dvh overflow-hidden); ein innerer Container scrollt. /dienstplan ist full-bleed & scrollt natürlich mit der Seite (NICHT mehr viewport-fixiert).
---

Das Master-Layout ist viewport-fixiert (`h-dvh overflow-hidden`); das Dokument/`body` scrollt NIE. Gescrollt wird stets ein innerer Container im Layout.

**Regel:** Jede Route (inkl. `/dienstplan`) rendert ihren Inhalt in einem inneren Scroll-Container (`min-h-0 flex-1 overflow-y-auto`) und wächst natürlich nach unten. Es gibt KEINEN viewport-fixierten „Full-Screen"-Modus mehr, in dem nur der Kalender autark scrollt.

`/dienstplan` läuft im **full-bleed**-Modus (Layout ist route-aware, Flag `fullBleed`):
- volle Bildschirmbreite (KEIN `max-w-7xl`-Container; Header-/Footer-Platzhalter der Plattform behalten `max-w-7xl`),
- natürliches Seiten-Scrollen (kein `overflow-hidden`/`flex-1`/`min-h-0` auf Seiten-Root oder Sektions-Wrappern; keine starren inneren Scrollbalken auf Kalender/Tabelle),
- Plattform-Footer dort weiterhin ausgeblendet.
Alle anderen Routen: zentrierter Inhalt (`max-w-7xl`) + Footer via `min-h-full`-Spalte.

Die Dienstplan-Kopfzeile ist `sticky top-0 z-40 bg-white/95 backdrop-blur` und bleibt beim Scrollen oben; sie nutzt `-mx-4 -mt-4 md:-mx-6 md:-mt-6`, passend zum `main`-Padding `p-4 md:p-6`.

**Why:** Anforderung „Dienstplan volle Breite + natürliches Scrollen"; der frühere viewport-fixierte Full-Screen-Grid-Ansatz wurde bewusst zurückgebaut.

**How to apply:**
- Seiten-Root und Sektions-Wrapper NICHT mit `overflow-hidden`/`min-h-0 flex-1` fesseln, sonst kein natürliches Wachstum. Auch den Loading-Branch gleich fließend halten.
- Der Assistenten-Filter auf `/dienstplan` ist ein kompaktes shadcn-`<Select>` in der Kopfzeile (testids `assistant-select`, `assistant-option-all`, `assistant-option-<id>`); die Pillen-`AssistantFilter`-Komponente bleibt nur auf `auswertungen`/`zeiterfassung`.
- E2E/Screenshots: gescrollt wird der innere Layout-Container; Playwrights `scrollIntoViewIfNeeded` funktioniert weiter.
