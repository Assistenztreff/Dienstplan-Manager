---
name: Lösch-Workflow mit Pflicht-Archiv (Stufe 5)
description: Warum das Löschen einer Assistenzkraft ein serverseitig erzwungenes Archiv braucht und wie der Ablauf gebaut ist.
---

# Lösch-Workflow einer Assistenzkraft

**Ausgangsproblem:** Eine Assistenzkraft zu löschen riss früher Schichten,
Abwesenheiten, Verträge und Zeiterfassung mit — genau die Daten, die § 16 ArbZG
und § 17 MiLoG zwei Jahre aufbewahrt sehen wollen. Der Löschschutz (Stufe 1,
`ON DELETE RESTRICT`) stoppte das, machte damit aber das Löschen **unmöglich**:
`DELETE FROM users` scheiterte an sechs Fremdschlüsseln und endete als 409.

**Kays Entscheidung (Option B):** echtes Löschen bleibt möglich — eine
Kontenliste voller „inaktiv seit 2024"-Karteileichen will er nicht. Aber nur
mit Export davor, und der Löschen-Knopf bleibt gesperrt, bis der Export
**tatsächlich heruntergeladen** wurde, nicht nur angeboten.

## Der Ablauf

1. `POST /users/:id/deletion-archive` — der **Server** baut das Archiv aus der
   Datenbank (`lib/deletion-archive.ts`), legt es in `deletion_archives` ab und
   liefert **dieselben Bytes** als Download zurück. Es gibt keine zweite
   Erzeugung, die abweichen könnte: die Datei im Ordner des Planers ist
   byte-gleich mit der im Archiv. Die Archiv-ID steht im Header
   `X-Deletion-Archive-Id`.
2. `DELETE /users/:id` prüft: gibt es ein Archiv für dieses Konto, von
   **diesem** Admin, **unbenutzt** und **jünger als 30 Minuten**? Sonst 409
   `deletion_archive_required`. Danach löscht es die abhängigen Zeilen und das
   Konto in EINER Transaktion und stempelt das Archiv als verbraucht.

**Kein Parameter am DELETE.** Ursprünglich sollte die `archiveId` als
Query-Parameter mitgehen — das geht nicht: hat eine Operation Pfad- UND
Query-Parameter, erzeugt Orval zweimal `<Op>Params` (Zod-Pfad + TS-Query) und
`lib/api-zod/src/index.ts` bricht mit TS2308. Deshalb die Frische-Fensterregel
statt einer durchgereichten ID. Gilt für **jeden** Endpunkt im Projekt.

## Was NICHT gelöscht wird

Gefiltert wird strikt auf `user_id` — nur die eigenen Zeilen der Person. Zeilen,
in denen sie als **handelnde** Person auftaucht (`changed_by`, `confirmed_by`,
`resolved_by`), bleiben unangetastet: das sind die Nachweise anderer Menschen.
Wo die Spalte es zulässt, leert Postgres sie selbst (`ON DELETE SET NULL`); wo
nicht (z. B. `shift_changes.changed_by`, NOT NULL), scheitert das DELETE
bewusst und wird als 409 `foreign_dependency` gemeldet. **Das ist gewolltes
Verhalten, kein Bug** — ein Planer, der die Zeiten anderer korrigiert hat,
lässt sich nicht entfernen, ohne fremde Aufzeichnungen zu beschädigen.

## Leere Konten

Ein Konto ohne Schichten, Verträge, Zeiterfassung, Abwesenheiten oder
Änderungshistorie wird **ohne** Archiv gelöscht (`hatAufbewahrungspflichtigeDaten`).
Ein Export-Ritual für eine eben angelegte Assistenzkraft wäre reine Schikane —
und hätte die bestehenden E2E-Specs gebrochen, die Wegwerf-Konten anlegen.

## Archiv-Inhalt

ZIP mit CSV-Tabellen (`00-hinweis.txt`, `10-stundenliste`, `20-zeiterfassung`,
`30-stundenkonto`, `40-lohnauswertung`, `50-aenderungen`, `60-vertraege`).
Bewusst CSV, nicht xlsx: ein Format, das in zehn Jahren noch jedes Programm
öffnet. Semikolon-Trenner plus `sep=;` und BOM, damit ein Doppelklick in Excel
sofort Spalten und korrekte Umlaute zeigt. Stundenkonto und Lohnauswertung
kommen aus `computeHoursBalances` — dieselbe Quelle wie die Auswertungsseite,
damit keine zweite, abweichende Sicht auf dieselben Zahlen entsteht.

## Fallen beim Erweitern

- `deletion_archives` hat **bewusst keinen** Fremdschlüssel auf `users` — er
  würde genau das Löschen blockieren, das die Tabelle ermöglichen soll. Name,
  E-Mail und auslösende Person stehen als Textschnappschuss drin.
- Jede neue Tabelle mit `team_id` muss in `TEAM_BOUND_TABLES`
  (`lib/test-fixtures/src/account-tree.ts`) eingetragen werden, sonst schlägt
  der Selbstheilungs-Check beim E2E-Start fehl.
- Spaltennamen vorher gegen das echte Schema prüfen: `time_tracking` hat
  `confirmed_at` (nicht `submitted_at`), der Stundenlohn hängt an
  `users.hourly_wage` (nicht am Vertrag). Beides hat hier je einen 500 gekostet.
