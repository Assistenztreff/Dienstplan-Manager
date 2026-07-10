---
name: Dialoge brauchen max-h + overflow seit Fullscreen-Layout
description: Warum DialogContent max-h-[90dvh] overflow-y-auto tragen muss, sonst sind Footer-Buttons mobil unerreichbar.
---

Regel: `DialogContent` (ui/dialog.tsx) muss `max-h-[90dvh] overflow-y-auto` behalten; neue Modal-Bausteine brauchen dieselbe Absicherung.

**Why:** Seit dem Fullscreen-Layout-Umbau scrollt der Body nie mehr. Ein Dialog, der höher als der Viewport ist (z. B. ShiftDialog auf 402px), hat dann KEINEN Scroll-Fallback — Speichern-Button real unerreichbar (Nutzer-Bug, in E2E als "element is outside of the viewport" trotz scrollIntoView sichtbar).

**How to apply:** Bei neuen Dialog-/Sheet-Varianten oder Overrides der Content-Klassen prüfen, dass max-h+overflow erhalten bleiben. Radix-Selects/Popovers sind portaled und werden vom Content-Scroll nicht geclippt.
