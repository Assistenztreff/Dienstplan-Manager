---
name: Tag-Schleife zu Zeitraum-Abfragen bündeln
description: Regeln, damit das Zusammenfassen einer Tag-für-Tag-Verarbeitung zu gesammelten Reads/Writes fachlich identisch bleibt.
---

# Regeln

1. **Stichtagsabhängige Werte bleiben stichtagsabhängig.** Ein rollierender
   Durchschnitt hat pro Tag ein eigenes Fenster: eine Abfrage über das
   Gesamtfenster, Wert dann je Stichtag daraus berechnen.
2. **Reihenfolge von Löschen und Rechnen aus dem Einzelpfad übernehmen.**
   Löscht der Einzelpfad ersetzte Daten vor der Berechnung, muss der Sammelweg
   das auch — sonst sieht Tag N noch Daten, die beim Einzel-Anlegen zu diesem
   Zeitpunkt längst weg sind. Die Reihenfolge im Code nachlesen, nicht raten.
3. **Löschmengen erst aus der endgültigen Zielmenge ableiten**, nicht aus allen
   geladenen Zeitraumdaten — sonst löscht der Sammelweg an Tagen, die der
   Einzelweg überspringt.
4. **Tagesgrenzen-Konvention des Einzelpfads übernehmen** (`DATE(spalte)` vs.
   Zeitstempel-Intervall), sonst Abweichungen an Zeitumstellungen.
5. **Alle Reads gehören hinter den Lock, in die schreibende Transaktion** —
   auch die scheinbar statischen Stammdaten (Verträge, Einstellungen). Sonst
   kann eine parallele Änderung zwischen Berechnung und Write fallen. Gilt auch
   für Reads in aufgerufenen Helfern: die brauchen dann einen Executor-Parameter.
6. **Vorhandene Scopes exakt spiegeln, auch inkonsistente.** Kommt im
   Einzelpfad dieselbe Entität an einer Stelle gescoped und an anderer
   ungescoped vor, ist das der Bestand — nicht im Zuge der Optimierung
   vereinheitlichen.
7. **Typ-/Kategorie-Semantik sitzt oft nicht im Aufrufer.** Wer eine
   Berechnung vorzieht, reicht den Typ weiter, statt eine eigene
   Fallunterscheidung nachzubauen.

**Why:** Alle betreffen nur Randfälle (Vertragswechsel, übersprungene Tage,
Zeitumstellung, Parallelaufträge, ersetzte Daten im Rückblick-Fenster) und sind
nicht typecheck-sichtbar — sie verfälschen dabei Lohn- und Kontodaten.

**How to apply:** Parität nicht argumentieren, sondern messen: denselben
Zeitraum einmal gesammelt und einmal als N Einzel-Requests ausführen und die
Ergebnisse vergleichen — über **alle** unterstützten Typen, nicht nur den
Hauptfall. Der Vergleich allein reicht nicht: zusätzlich gegen einen erwarteten
Wert prüfen, sonst wird der Test auch grün, wenn beide Pfade gemeinsam falsch
rechnen. Für Punkt 5 einen Konkurrenztest, der eine Stammdaten-Änderung gegen
den laufenden Sammelauftrag schickt und auf einen kohärenten Stand prüft (nicht
auf einen bestimmten der beiden Stände — welcher gewinnt, ist Timing).
