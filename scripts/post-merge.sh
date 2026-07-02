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
pnpm --filter db push
