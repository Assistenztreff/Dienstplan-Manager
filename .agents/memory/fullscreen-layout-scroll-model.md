---
name: Full-Screen-Layout & Scroll-Modell
description: Seit dem Full-Screen-Grid-Umbau scrollt nie das Dokument, sondern innere Container; Auswirkungen auf neue Seiten und E2E-Tests.
---

Das Master-Layout ist viewport-fixiert (`h-dvh overflow-hidden`); das Dokument/`body` scrollt NIE mehr.

**Regel:** Seiten scrollen in einem inneren Scroll-Container. `/dienstplan` läuft im Full-Screen-Modus (Layout ist route-aware): die Seite bekommt exakt die Resthöhe, nur der Kalenderbereich scrollt autark, der Plattform-Footer ist dort ausgeblendet. Alle anderen Routen scrollen in einem Container-Div (Footer via `min-h-full`-Spalte + `flex-1` auf main unten angepinnt).

**Why:** Anforderung „Kalender 100 % im Viewport, kein globales Scrollen“, ohne lange Seiten (Dashboard/Einstellungen) zu brechen.

**How to apply:**
- Neue Seiten, die viewport-fixiert sein sollen, müssen in der Layout-`fullScreen`-Routenprüfung ergänzt werden UND selbst `flex min-h-0 flex-1 flex-col overflow-hidden` als Root nutzen (auch im Loading-Branch, sonst Clipping!).
- E2E/Screenshots: `window.scrollTo`/Dokument-Scroll ist wirkungslos; gescrollt wird der innere Container. Playwrights `scrollIntoViewIfNeeded` funktioniert weiter.
- Die `min-h-0`-Kette darf an keinem Zwischen-Flex-Glied fehlen, sonst wächst der Kalender aus dem Viewport statt intern zu scrollen.
