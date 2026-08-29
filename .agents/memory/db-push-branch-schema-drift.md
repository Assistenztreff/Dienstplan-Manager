---
name: db push vom falschen Branch löscht fremde Tabellen
description: Preview-DB wird von allen Branches geteilt, `drizzle-kit push` setzt aber nur das Schema des ausgecheckten Branches durch — Push von main will branch-eigene Tabellen/Spalten löschen.
---

# `drizzle-kit push` immer nur vom Branch mit dem NEUESTEN Schema

Die Replit-Preview-Datenbank ist **eine** DB, geteilt von allen Branches. `drizzle-kit push`
gleicht sie aber gegen das Schema des **gerade ausgecheckten Branches** ab. Wer auf `main`
(oder einem älteren Branch) steht und pusht, bekommt für jede Tabelle/Spalte, die nur auf
einem Feature-Branch existiert, ein `DROP` vorgeschlagen — inklusive der bereits erfassten
Daten.

**Real aufgetreten (29.08.2026):** Push von `origin/main`, während die DB den Stand von
`claude/neue-session-tuv319` hatte:

```
· You're about to delete shift_deviation_reports table with 2 items
· You're about to delete shift_changes table with 6 items
· You're about to delete standby_user_id column in shifts table with 184 items
```

**Regeln:**

1. Vor jedem `pnpm --filter @workspace/db run push`: `git branch --show-current` prüfen.
   Push nur vom Branch mit dem neuesten Schema, nie von `main`, solange Feature-Branches
   noch nicht gemerged sind.
2. Die Data-Loss-Abfrage **immer lesen**. Ein `DROP` auf etwas, das man wiedererkennt,
   heißt: falscher Branch — nicht "die Tabelle kann weg". Abbrechen mit "No, abort".
3. Niemals `push-force` benutzen, um an so einer Abfrage vorbeizukommen.

## Kehrseite: Schema-Änderung ohne Push = 500 in der Preview

Das Projekt hat **keine Migrationsdateien** — das Schema kommt ausschließlich per `push` in
die DB. Nach jedem Commit, der `lib/db/src/schema/` anfasst, muss der Push laufen, sonst
brechen alle Queries ab, die die neue Spalte selektieren.

**Real aufgetreten (29.08.2026):** Der Vertretungsvergütung-Commit fügte
`allowance_settings.vertretung_compensation_mode`/`-_value` hinzu; ohne Push lieferte
`GET /api/dashboard/hours-balance` einen 500er. Symptom im UI war irreführend: Das
Stundenkonto rendert weiter, zeigt aber bei **allen** Personen "kein Vertrag", keinen
Fortschrittsbalken und keinen Saldo — denn die verplanten Stunden rechnet das Frontend
selbst aus den Schichten, nur `contractMonthlyTargetHours` kommt aus der API. Dieselbe
kaputte Abfrage nahm auch den Kapazitäts-Punkten in der Vertretungs-Auswahl die Datenbasis.

**Merkmal zum Wiedererkennen:** Fehlt der Vertrag bei *allen* Personen gleichzeitig,
während verplante Stunden korrekt erscheinen, ist es nie ein Datenproblem an den
Verträgen, sondern die Bilanz-Route. Der Browser sieht nur `{"error":"Interner
Serverfehler"}` (`app.ts:197`); die echte Meldung steht im Operator-Dashboard unter
"Fehler-Tracking" (Kontext `GET /api/dashboard/hours-balance`) und im Server-Log.
