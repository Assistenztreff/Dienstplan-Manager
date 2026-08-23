---
name: PG-Pool bei parallelen Kaltpfaden
description: Nicht offensichtliches Zusammenspiel aus Remote-Postgres, parallelen Query-Wellen und node-postgres-Pool-Warmup.
---

Bei latenzkritischen Remote-Postgres-Pfaden genügt es nicht, serielle Queries nur mit `Promise.all` zu parallelisieren: Öffnet der Pool dabei erstmals mehrere TLS-Verbindungen, dominiert deren Aufbau weiterhin den ersten Request. Die vorgehaltene Verbindungszahl muss mindestens die größte gleichzeitig gestartete Query-Welle abdecken. `pg.Pool` öffnet durch `min` allein keine Verbindungen; `min` bewahrt erst bereits aufgebaute Clients vor dem Idle-Abbau, deshalb braucht der API-Start zusätzlich ein explizites Warmup.

**Why:** Beim kalten Stundenbilanz-Pfad senkte reine Query-Parallelisierung die Remote-Latenz nur teilweise. Erst ein explizites Pool-Warmup in Kombination mit einer passenden `min`-Größe machte den ersten Drei-Personen-Aufruf stabil sub-sekündig.

**How to apply:** Bei neuen stark parallelisierten DB-Wellen zuerst die maximale gleichzeitige Query-Zahl bestimmen, das pro Prozess erlaubte `max` explizit begrenzen und die resultierende Gesamtzahl über alle Replikate gegen das DB-Verbindungslimit prüfen. Periodische Keepalives dürfen nicht alle Clients gleichzeitig reservieren.