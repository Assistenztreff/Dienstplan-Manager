---
name: Bulk-Write-Verträge (Cache-Patch + Race-Schutz)
description: Zwei durable Regeln für Sammel-Schreibrouten — Antwort muss Cache-Patches ermöglichen; Konfliktprüfung gehört unter den Advisory-Lock in die Transaktion
---

**Regel 1:** Sammel-Schreibrouten geben volle Zeilen UND das aufgelöste
Ziel-`teamId` zurück, nicht nur IDs/Zähler.
**Why:** Das Shift-DTO strippt `teamId` bewusst (Datenschutz-Kontrakt). Der
Client patcht nach dem Speichern die Listen-Caches direkt, damit der Dialog
sofort schließen kann — ohne mitgeliefertes `teamId` sind team-gescopte Listen
nicht zuordenbar und bleiben bis zur Hintergrund-Invalidierung stale.
**How to apply:** Ergebnis-Schema neuer Bulk-Routen: volle Zeilen (nach der
Transaktion in Listen-Form nachladen) + `teamId` + ggf. ersetzte IDs. Client:
Listen-Filter exakt spiegeln (Monat/Jahr nur GEMEINSAM, in UTC — Server
filtert auf timestamptz); im atomaren 409-Fehlerpfad nichts invalidieren.

**Regel 2:** Check-then-insert-Konfliktprüfungen (Overlap/Duplikat) gehören
INS `db.transaction` hinter einen `pg_advisory_xact_lock` pro Zielperson bzw.
Team (Team-Duplikate sind team-weit!).
**Why:** Vor der Transaktion geprüfte Konflikte sind ein TOCTOU-Race — zwei
gleichzeitige Aufträge (Doppelklick, zwei Fenster) sehen beide einen freien
Bestand und buchen doppelt (bei Teamsitzungen: doppelte Stunden-Gutschrift,
bei Urlaub: doppelter Abzug). Exclusion-Constraints sind hier KEINE Option,
weil `force` Überschneidungen legitim zulässt.
**How to apply:** Lock als erste Anweisung der Transaktion (Schlüssel z. B.
`hashtext('kontext:user:<id>')`); Helfer dürfen danach über den Pool lesen —
der Vorgänger hat beim Lock-Release bereits committet. Absichern per
Parallel-Test: zwei identische gleichzeitige Requests, genau einer schreibt.
