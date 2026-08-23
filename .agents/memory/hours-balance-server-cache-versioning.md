---
name: Server-Cache-Versionierung für Stundenbilanzen
description: Warum ein fachlicher Generationszähler statt PostgreSQL-Transaktionsständen für instanzübergreifende Cache-Invalidierung nötig ist.
---

Für prozesslokale Stundenbilanz-Caches eine gemeinsame, fachliche Generation
verwenden. Diese Generation erst nach erfolgreichen Schreibzugriffen auf
Bilanz-Grundlagen oder Team-Scope hochzählen und die erfolgreiche HTTP-Antwort
erst danach abschließen. Jeder Read prüft die Generation, bevor er einen lokalen
Treffer verwendet.

**Why:** PostgreSQL-Snapshot-/Transaktionsstände ändern sich in der gemeinsam
genutzten Datenbank fortlaufend durch fachfremde Writes (unter anderem Sessions
und Betriebsdaten). Ein Cache daran war zwar korrekt, erzielte aber praktisch
kaum Treffer. Eine reine lokale TTL wäre über mehrere API-Instanzen dagegen
inhaltlich unsicher.

**How to apply:** Neue API-Schreibpfade, die Schichten, Zeiterfassung, Verträge,
Zuschlagseinstellungen, Nutzer, Mitgliedschaften, Teams, Schichtmodelle oder den
Lesescope ändern, müssen vor ihrer 2xx-Antwort die fachliche Generation erhöhen.
Cache-Ausgaben immer kopieren, wenn Verbraucher Ergebnisobjekte redigieren oder
anderweitig mutieren.