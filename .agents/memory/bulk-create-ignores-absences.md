---
name: Sammel-Anlage meldet Abwesenheiten nicht als Konflikt
description: Offener Punkt — POST /shifts/bulk prueft Ueberschneidungen gegen KEINE Abwesenheitsart (auch nicht Urlaub), waehrend die Einzel-Anlage genau das tut.
---

# Offen: Sammel-Anlage ignoriert Abwesenheiten bei der Konfliktpruefung

**Status: gefunden am 29.08.2026, NICHT behoben.** Bewusst nicht nebenbei
mitrepariert, weil es Bestandsverhalten ist und eine eigene Abstimmung mit dem
Auftraggeber braucht (wie soll die Sammel-Anlage auf Urlaub reagieren —
warnen, ueberspringen, oder wie bisher stillschweigend anlegen?).

## Der Widerspruch

Zwei Pfade pruefen dieselbe Frage unterschiedlich:

- **Einzel-Anlage** (`findOverlappingShifts`, `routes/shifts.ts` ~618):
  Die Ausnahmeliste enthaelt `vacation` NICHT → ganztaegiger Urlaub loest eine
  Ueberschneidungswarnung aus. `wunschfrei` verhaelt sich seit 29.08.2026
  genauso (ebenfalls nicht in der Liste).
- **Sammel-Anlage** (`routes/shifts-bulk.ts` ~489): Die Ausnahmeliste enthaelt
  ALLE Abwesenheitsarten inklusive `vacation` → beim Anlegen mehrerer Dienste
  auf einmal warnt nichts, auch nicht bei Urlaub.

Wer also einen Monat per Mehrfachauswahl verplant, bekommt Dienste auf
Urlaubstage gelegt, ohne dass etwas auffaellt. Beim einzelnen Anlegen desselben
Dienstes kaeme eine Warnung.

## Beim Beheben beachten

`wunschfrei` wurde der Sammel-Ausnahmeliste bewusst hinzugefuegt, damit es sich
exakt wie `vacation` verhaelt — nicht strenger. Wird die Liste korrigiert,
muessen beide Arten gemeinsam rausfliegen, sonst entsteht ein zweiter
Sonderfall.
