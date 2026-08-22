---
name: Stunden-Bilanz Query-Invalidierung nach Schicht-Mutationen
description: Jede Mutation, die die Wertung (valuedHours) einer Schicht ändert, muss auch die hours-balance-Query invalidieren, nicht nur die Schicht-Liste — sonst zeigt die Auswertungen-Seite/Dashboard-Kachel den Stand von VOR der Änderung.
---

Die Kalender-Sicht (Schicht-Liste) und die Stunden-Bilanz-Sicht
(Auswertungen-Seite + Dashboard-Kachel) hängen an zwei getrennten
React-Query-Caches. Ein Backend-Fix, der `valuedHours` korrekt neu berechnet,
reicht nicht aus, wenn eine Mutation im Frontend nur die Schicht-Liste
invalidiert — die Stunden-Bilanz-Query bleibt dann bis zum Ablauf der
globalen `staleTime` (5 min) auf dem alten Stand, selbst nach vollem
Seiten-Reload oder Navigation über die reale Kalender-→Auswertungen-Route.

**Warum nicht sofort auffällig:** Ein rein API-basierter Regressionstest
prüft nur die Backend-Antwort und sieht diesen Cache-Bug nie — nur ein
Klick-Test, der zwischen den beiden Seiten über echte Client-Navigation
wechselt (nicht `page.goto`, das erzeugt pro Aufruf einen neuen Query-Client
und verschleiert das Problem), deckt ihn auf. Zum Nachweis: Zielseite zuerst
laden (füllt den Cache mit dem Vorher-Stand), dann per In-App-Link mutieren
und zurücknavigieren, erst dann den Cache-Wert prüfen.

**How to apply:** Jede Mutation, die `valuedHours`, `plannedHours` oder
Zuschläge einer Schicht beeinflusst (Zeit-, Typ- oder Modell-Änderung,
Einzel- UND Sammel-Bearbeitung), muss die Stunden-Bilanz-Query mit
invalidieren — nicht nur die Schicht-Liste. Es gibt bereits einen korrekten
Präzedenzfall dafür im Code (Monatsabschluss-Flow); an neuen/geänderten
Schicht-Mutationen prüfen, ob sie diesem Muster folgen.
