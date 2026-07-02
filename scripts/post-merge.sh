#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run migrate-teams
# Zuschlags-Einstellungen von der globalen Singleton-Zeile auf Pro-Konto-Zeilen
# migrieren (idempotent, VOR db push — sonst fragt push interaktiv nach
# NOT NULL/UNIQUE auf der befüllten Tabelle und bricht ohne TTY ab).
pnpm --filter @workspace/scripts run migrate-allowance-settings
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
  exit 1
fi
