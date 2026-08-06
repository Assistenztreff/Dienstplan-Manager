/**
 * Gemeinsame Quelle der idempotenten SQL-Vorab-Schritte vor `drizzle-kit push`.
 *
 * Zweck: Bestands-DBs prompt-frei auf den Zielzustand bringen, damit push ohne
 * TTY nicht an interaktiven Rückfragen (UNIQUE/NOT NULL/Data-Loss) scheitert.
 *
 * Verwendet von:
 * - scripts/post-merge.sh (via `pnpm --filter @workspace/scripts run pre-push-sql`)
 * - scripts/src/migrate-prod.ts (direkt importiert, läuft gegen die Prod-URL)
 *
 * Regeln für neue Einträge: strikt idempotent (IF NOT EXISTS / DO-$$-Guards),
 * keine interaktiven Effekte, keine destruktiven Statements ohne Existenz-Guard.
 */
export const PRE_PUSH_SQL: string[] = [
  // calendar_token (Kalender-Abo-Feed): drizzle-kit push fragt bei neuen
  // UNIQUE-Constraints interaktiv nach.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token text;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_calendar_token_unique') THEN
       ALTER TABLE users ADD CONSTRAINT users_calendar_token_unique UNIQUE (calendar_token);
     END IF;
   END $$;`,
  // Team-Overrides für Zuschlags-Einstellungen: team_id + partieller Index
  // statt altem UNIQUE(owner_id).
  `ALTER TABLE allowance_settings ADD COLUMN IF NOT EXISTS team_id integer;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowance_settings_team_id_teams_id_fk') THEN
       ALTER TABLE allowance_settings
         ADD CONSTRAINT allowance_settings_team_id_teams_id_fk
         FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowance_settings_team_id_unique') THEN
       ALTER TABLE allowance_settings ADD CONSTRAINT allowance_settings_team_id_unique UNIQUE (team_id);
     END IF;
   END $$;`,
  `ALTER TABLE allowance_settings DROP CONSTRAINT IF EXISTS allowance_settings_owner_id_unique;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS allowance_settings_owner_account_unique
     ON allowance_settings (owner_id) WHERE team_id IS NULL;`,
  // Branding-Tabellen: Surrogat-Spalte id (serial PK) entfernt, fachliche
  // Spalte (owner_id/team_id) ist PK — push würde wegen Spalten-Drop fragen.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'branding_settings' AND column_name = 'id') THEN
       ALTER TABLE branding_settings DROP CONSTRAINT IF EXISTS branding_settings_pkey;
       ALTER TABLE branding_settings DROP COLUMN id;
       ALTER TABLE branding_settings DROP CONSTRAINT IF EXISTS branding_settings_owner_id_unique;
       ALTER TABLE branding_settings ADD CONSTRAINT branding_settings_pkey PRIMARY KEY (owner_id);
     END IF;
   END $$;`,
  `DROP SEQUENCE IF EXISTS branding_settings_id_seq;`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'team_branding_settings' AND column_name = 'id') THEN
       ALTER TABLE team_branding_settings DROP CONSTRAINT IF EXISTS team_branding_settings_pkey;
       ALTER TABLE team_branding_settings DROP COLUMN id;
       ALTER TABLE team_branding_settings DROP CONSTRAINT IF EXISTS team_branding_settings_team_id_unique;
       ALTER TABLE team_branding_settings ADD CONSTRAINT team_branding_settings_pkey PRIMARY KEY (team_id);
     END IF;
   END $$;`,
  `DROP SEQUENCE IF EXISTS team_branding_settings_id_seq;`,
  // Vertrags-Override der Abrechnungsart entfernt: Alt-Werte neutralisieren,
  // damit historische Verträge die Auswertung nie wieder beeinflussen können.
  // Spalte bleibt (Drop wäre ein interaktiver Data-Loss-Prompt), wird aber
  // nirgends mehr gelesen. Guard: nur wenn die Spalte (noch) existiert.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'contracts' AND column_name = 'billing_method') THEN
       UPDATE contracts SET billing_method = NULL WHERE billing_method IS NOT NULL;
     END IF;
   END $$;`,
  // Arbeitstage/Woche: Dezimalwerte (real statt integer) + Bestätigungs-
  // Zeitstempel für den Datenpflege-Hinweis. Typänderung nur, wenn die Spalte
  // noch integer ist (push würde sonst interaktiv nach Datenverlust fragen).
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'contracts' AND column_name = 'workdays_per_week'
                  AND data_type = 'integer') THEN
        ALTER TABLE contracts ALTER COLUMN workdays_per_week TYPE real;
     END IF;
   END $$;`,
  `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS workdays_confirmed_at timestamp;`,
];

/** Alle Vorab-Schritte sequenziell gegen den übergebenen Client ausführen. */
export async function runPrePushSql(client: {
  query: (sql: string) => Promise<unknown>;
}): Promise<void> {
  for (const stmt of PRE_PUSH_SQL) {
    await client.query(stmt);
  }
}
