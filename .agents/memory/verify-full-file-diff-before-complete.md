---
name: Diff against origin baseline before marking complete
description: A single targeted Edit can end up committed alongside a much larger, inconsistent diff in the same file; verify scope before trusting a green typecheck.
---

Auf einer bereits `IN_PROGRESS` Task, die aus einer Vorsitzung übernommen wird,
kann die Datei, die man bearbeitet, schon unfertige/verwaiste Änderungen aus
der Vorsitzung enthalten, die nicht zur eigenen (kleinen) Edit gehören. Ein
lokaler `tsc --noEmit -p .` direkt nach der eigenen Edit kann grün sein
(Incremental-Cache), obwohl der spätere Merge-/Checkpoint-Commit eine
Datei enthält, die an anderer Stelle inkonsistente/veraltete Variablennamen
mischt (z. B. zwei Entwicklungsstände derselben Route durcheinander) und beim
nächsten vollen Typecheck (`pnpm run typecheck`, ohne Cache-Vorteil) hunderte
Fehler wirft.

**Wann prüfen:** Vor `markTaskComplete` bei einer Task, die als `IN_PROGRESS`
übernommen wurde (nicht frisch `PROPOSED`) — `git diff <letzter bekannter
guter Commit/origin> -- <bearbeitete Datei>` lesen und sicherstellen, dass der
Diff nur die eigenen, beabsichtigten Zeilen plus plausible Vorarbeit enthält,
BEVOR man sich auf einen lokalen, projektbezogenen `tsc`-Lauf verlässt. Ein
sauberer Wiederherstellungsweg: Datei aus dem letzten Commit auszuchecken, der
für genau diese Datei nachweislich 0 Syntaxfehler hatte (git show
<commit>:<pfad> gegen `ts.createSourceFile`/vollen Typecheck prüfen), und die
eigene kleine Änderung darauf erneut anwenden statt die kaputte Version von
Hand zu reparieren.
