---
name: Parallele E2E-Lanes teilen api-server dist/
description: API-Shards müssen einen einmaligen Vorab-Build gemeinsam lesen, statt je Lane den gemeinsamen dist/-Ordner neu zu bauen.
---

# Build-Race: parallele E2E-Lanes teilen `artifacts/api-server/dist`

Parallele API-Shards haben getrennte Datenbanken und Ports, teilen im selben
Workspace aber weiterhin den API-Build-Ordner. Ein Build löscht diesen Ordner
vor dem Schreiben. Baut jeder Shard selbst, kann ein anderer Shard genau dann
den Einstieg oder eine Logging-Worker-Datei laden wollen und mit
`MODULE_NOT_FOUND` sterben.

**Why:** Getrennte DBs, Ports und Locks isolieren Laufzeitdaten, aber keine
Dateisystem-Ausgaben. Der Fehler ist timingabhängig; häufig läuft die andere
Lane vollständig grün und die fehlende Datei wechselt zwischen Einstieg und
Worker.

**How to apply:** Vor parallelen Shards den API-Server genau einmal seriell
bauen; die Shard-WebServer starten anschließend nur den vorhandenen Build.
Neue parallele Lanes dürfen keinen Befehl verwenden, der den gemeinsamen
Build-Ordner erneut erzeugt. Bei erneutem `MODULE_NOT_FOUND` zuerst prüfen,
ob ein externer Dev-Workflow während des Laufs denselben Ordner neu gebaut hat.
