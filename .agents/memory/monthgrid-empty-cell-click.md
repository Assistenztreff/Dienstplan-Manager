---
name: MonthGrid Leere-Zelle-Klickmodell
description: Leere Tageszellen öffnen den Schicht-Dialog direkt (kein Zwei-Stufen-Klick); Auswahl muss trotzdem gesetzt werden
---

Im MonthGrid öffnet ein Klick auf eine LEERE Tageszelle den Schicht-Dialog direkt; nur Zellen mit Einträgen nutzen das Zwei-Stufen-Modell (1. Klick markiert, 2. Klick öffnet).

**Why:** Beim MonthGrid-Redesign ging verloren, dass der Leere-Zellen-Klick auch `onSelectDay(day)` setzt — dadurch blieb `data-selected="false"`, das Tagesdetail folgte nicht dem Klick, und 8 shift-dialog-E2E-Specs (Helper `selectDayCell` erwartet Markierung) waren still rot auf main.

**How to apply:** Jeder Klick-Pfad, der einen Tag betrifft (direkt öffnen, zweiter Klick, Tastatur), muss die Auswahl mitführen. Der E2E-Helper `selectDayCell` toleriert den direkt öffnenden Dialog (Escape), verlässt sich aber darauf, dass die Zelle danach markiert ist. Bei rätselhaften `data-selected`-Fehlschlägen zuerst prüfen, ob die Zelle leer war.
