---
name: Stundenlisten-Export — Vormonats-Block (Änderungen)
description: Warum der Export die Änderungshistorie braucht, wo sie herkommt und wie der Block aufgebaut ist.
---

# Vormonats-Block im Stundenlisten-Export (Stufe 4)

**Kays Vorgabe:** unterhalb der Monatstabelle steht eine Vormonats-Ansicht in
derselben Formatierung, die alle geänderten Dienstzeiten des letzten Monats
zeigt und die Änderung nachvollziehbar macht.

**Datenquelle ist NICHT die Schichtliste, sondern `shift_changes`.** Ein Export
zeigt nur, was im Moment des Klickens in der Datenbank steht — ein
überschriebener Dienst wäre ohne Protokolltabelle unwiederbringlich weg. Das
Excel ist die **Anzeige**, nicht der **Speicherort**. Deshalb musste die
Historie (Stufe 2) vor dem Export (Stufe 4) kommen.

**Endpunkt:** `GET /shifts/changes/history?month=&year=[&teamId=]`
(`artifacts/api-server/src/routes/shifts-changes.ts`). Abzugrenzen von
`GET /shifts/changes`, das per `DISTINCT ON` nur die JÜNGSTE Zeile je Dienst
liefert — das ist die Korrektur-Kennzeichnung im Dienstplan, nicht der Export.
Die History-Route liefert **jede** Änderung einzeln.

**Monatszuordnung über das DIENST-Datum aus dem Snapshot, nicht über
`created_at`:** eine Korrektur im August an einem Juli-Dienst gehört in den
Juli-Block. Gefiltert wird `before ODER after im Monat`, damit ein über die
Monatsgrenze verschobener Dienst in beiden Monaten auftaucht.

**Layout (Kay-Entscheidung: eine Zeile je Änderung):** die ersten fünf Spalten
sind identisch zur Monatstabelle darüber und zeigen den NEUEN Wert; rechts
daneben `Vorher`, `Std. vorher`, `Geändert von`, `Geändert am`. Der Auslöser
(`planner_edit` / `deviation_accepted` / `correction_withdrawn`) steht in
Klammern hinter dem Namen statt in einer zehnten Spalte. Datum und alte
Assistenzkraft erscheinen in `Vorher` nur, wenn sie sich geändert haben.

**Stunden im Block sind Spanne minus Pause, NICHT `valuedHours`** — den
bewerteten Wert des alten Standes gibt es nirgends mehr. Beide Spalten rechnen
deshalb gleich, damit die Differenz stimmt.

**Geladen wird erst beim Klick auf Exportieren**, nicht beim Öffnen der
Auswertungsseite (`export-auswahl-card.tsx`). Schlägt der Aufruf fehl, entfällt
der Block still — die Monatstabelle ist die Hauptsache. Ein leeres Array
erzeugt dagegen bewusst die Zeile „Keine Änderungen": ein sichtbares
„geprüft, nichts da" ist als Nachweis mehr wert als ein fehlender Abschnitt.

**Löschschutz:** `shift_changes.shift_id` ist seitdem nullable mit
`ON DELETE SET NULL` (vorher `cascade` — das Löschen eines einzelnen Dienstes
riss seine Nachweiszeilen mit). `restrict` schied aus, sonst ließe sich gar
kein Dienst mehr löschen. Die Auswertung braucht den Fremdschlüssel ohnehin
nicht: `before`/`after` sind vollständige Snapshots. Siehe
[drizzle-push-ignores-fk-actions](drizzle-push-ignores-fk-actions.md) — die
geänderte FK-Regel kommt nur über `pre-push-sql.ts` an.
