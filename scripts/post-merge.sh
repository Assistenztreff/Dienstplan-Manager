#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run migrate-teams
# Zuschlags-Einstellungen von der globalen Singleton-Zeile auf Pro-Konto-Zeilen
# migrieren (idempotent, VOR db push — sonst fragt push interaktiv nach
# NOT NULL/UNIQUE auf der befüllten Tabelle und bricht ohne TTY ab).
pnpm --filter @workspace/scripts run migrate-allowance-settings
# Bestands-Abwesenheiten (Urlaub/Krankheit) einmalig auf verbindlichen Status FIX
# korrigieren, damit sie in den Auswertungen erscheinen. Reine Daten-Migration
# (kein Schema-Prompt), idempotent — Reihenfolge unkritisch.
pnpm --filter @workspace/scripts run migrate-absences-fix
# Bestehende Teams OHNE ein einziges Schichtmodell bekommen die 5 Standard-
# Dienste nachgezogen (neue Teams werden seit dem Schicht-Dialog-Fix direkt
# beim Anlegen geseedet). Reine Daten-Migration, idempotent.
pnpm --filter @workspace/scripts run backfill-team-shift-models
# calendar_token (Kalender-Abo-Feed) idempotent VOR db push anlegen: drizzle-kit
# push fragt bei neuen UNIQUE-Constraints interaktiv nach (kein TTY im
# Post-Merge => Abbruch). Vorab angelegt erkennt push "no changes".
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_calendar_token_unique') THEN
    ALTER TABLE users ADD CONSTRAINT users_calendar_token_unique UNIQUE (calendar_token);
  END IF;
END $$;
SQL
# Team-Overrides für Zuschlags-Einstellungen: allowance_settings.team_id
# idempotent VOR db push anlegen und den alten UNIQUE(owner_id)-Constraint
# durch einen partiellen Index (nur Konto-Zeilen, team_id IS NULL) ersetzen —
# drizzle-kit push würde dafür interaktiv nachfragen (kein TTY => Abbruch).
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE allowance_settings ADD COLUMN IF NOT EXISTS team_id integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowance_settings_team_id_teams_id_fk') THEN
    ALTER TABLE allowance_settings
      ADD CONSTRAINT allowance_settings_team_id_teams_id_fk
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowance_settings_team_id_unique') THEN
    ALTER TABLE allowance_settings ADD CONSTRAINT allowance_settings_team_id_unique UNIQUE (team_id);
  END IF;
END $$;
ALTER TABLE allowance_settings DROP CONSTRAINT IF EXISTS allowance_settings_owner_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS allowance_settings_owner_account_unique
  ON allowance_settings (owner_id) WHERE team_id IS NULL;
SQL
# Branding-Tabellen: Die Surrogat-Spalte `id` (serial PK) wurde aus dem Drizzle-
# Schema entfernt (owner_id bzw. team_id ist jetzt PK). Auf Dev-DBs mit dem
# alten Zustand fragt db push interaktiv wegen des Spalten-Drops (Data-Loss-
# Warnung) und bricht ohne TTY ab. Idempotenter Vorab-Umbau: id-Spalte + alte
# PK/UNIQUE-Constraints entfernen, PK auf die fachliche Spalte legen.
psql "$DATABASE_URL" <<'SQL'
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'branding_settings' AND column_name = 'id') THEN
    ALTER TABLE branding_settings DROP CONSTRAINT IF EXISTS branding_settings_pkey;
    ALTER TABLE branding_settings DROP COLUMN id;
    ALTER TABLE branding_settings DROP CONSTRAINT IF EXISTS branding_settings_owner_id_unique;
    ALTER TABLE branding_settings ADD CONSTRAINT branding_settings_pkey PRIMARY KEY (owner_id);
  END IF;
END $$;
DROP SEQUENCE IF EXISTS branding_settings_id_seq;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'team_branding_settings' AND column_name = 'id') THEN
    ALTER TABLE team_branding_settings DROP CONSTRAINT IF EXISTS team_branding_settings_pkey;
    ALTER TABLE team_branding_settings DROP COLUMN id;
    ALTER TABLE team_branding_settings DROP CONSTRAINT IF EXISTS team_branding_settings_team_id_unique;
    ALTER TABLE team_branding_settings ADD CONSTRAINT team_branding_settings_pkey PRIMARY KEY (team_id);
  END IF;
END $$;
DROP SEQUENCE IF EXISTS team_branding_settings_id_seq;
SQL
# WICHTIG (verifiziert): Nach diesem Skript laeuft die Plattform-
# "Workflow-Reconciliation" und startet bereits laufende Workflows neu —
# und zwar SOWOHL bei Erfolg ALS AUCH bei Fehlschlag des Skripts. Der
# API-Server laedt also nach erfolgreichem db push garantiert den neuen
# Drizzle/Zod-Stand (kein manueller Restart hier noetig). Kehrseite: bei
# einem db-push-Fehlschlag laeuft der Server danach mit NEUEM Code gegen
# eine VERALTETE Dev-DB — deshalb muss dieses Skript hart abbrechen und
# den Fehler unten unmissverstaendlich benennen.
# drizzle-kit push beendet sich auch bei "Interactive prompts require a TTY"
# mit Exit-Code 0 (!) — der Exit-Code allein reicht also nicht. Die Dev-DB ist
# NICHT wegwerfbar (kein Drop+Recreate wie bei der Test-DB), deshalb wird die
# Ausgabe mitgeschnitten und auf die bekannten Fehlermuster geprüft; bei
# Treffern bricht post-merge hart ab, statt die Dev-DB still veralten zu lassen
# (sonst strippt der API-Server neue Felder still).
# stdin auf /dev/null: bei interaktiven Rückfragen soll push sofort mit
# "Interactive prompts require a TTY" abbrechen statt zu hängen.
push_status=0
push_output="$(pnpm --filter db push < /dev/null 2>&1)" || push_status=$?
printf '%s\n' "$push_output"
if [ "$push_status" -ne 0 ] \
  || printf '%s' "$push_output" | grep -qi 'Interactive prompts require a TTY' \
  || printf '%s' "$push_output" | grep -Eq '^[[:space:]]*Error:'; then
  echo "FEHLER: db push ist fehlgeschlagen (siehe Ausgabe oben)." >&2
  echo "Die Dev-DB ist jetzt moeglicherweise veraltet. Schema-Aenderung braucht" >&2
  echo "vermutlich einen idempotenten SQL-Vorab-Schritt (siehe calendar_token oben)." >&2
  echo "ACHTUNG: Die Workflow-Reconciliation startet den API-Server trotzdem neu —" >&2
  echo "er laeuft dann mit NEUEM Code gegen die VERALTETE Dev-DB (Laufzeitfehler/" >&2
  echo "still gestrippte Felder moeglich), bis db push repariert und erneut" >&2
  echo "ausgefuehrt wurde." >&2
  exit 1
fi
