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
  // hour_budgets (Zielvereinbarungen/Stundenbudget, Premium): neue Tabelle mit
  // NOT NULL-FK auf teams — auf Bestands-DBs kann push dafür interaktiv
  // nachfragen, daher vorab idempotent anlegen (inkl. FK-Guard).
  `CREATE TABLE IF NOT EXISTS hour_budgets (
     id serial PRIMARY KEY,
     team_id integer NOT NULL,
     monthly_hours real NOT NULL,
     start_date date NOT NULL,
     end_date date,
     notes text,
     created_at timestamp DEFAULT now() NOT NULL
   );`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hour_budgets_team_id_teams_id_fk') THEN
       ALTER TABLE hour_budgets
         ADD CONSTRAINT hour_budgets_team_id_teams_id_fk
         FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
     END IF;
   END $$;`,
  // Gestufte Team-Freischaltung (team_members.access_level): neuer Enum-Typ
  // PLUS neue NOT-NULL-Spalte auf einer befüllten Tabelle — genau die
  // Kombination, bei der push ohne TTY interaktiv nachfragen kann. Daher
  // vorab idempotent: Typ anlegen, Spalte nullable ergänzen, Bestandszeilen
  // auf den Standard "keine" setzen, dann NOT NULL erzwingen.
  // Bewusst KEIN Backfill für is_teamleiter=true: das Teamleiter-Flag wird im
  // Code getrennt als höchste Stufe gewertet, es darf keine zweite Quelle geben.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_access_level') THEN
       CREATE TYPE team_access_level AS ENUM ('keine', 'basis', 'stufe1', 'stufe2');
     END IF;
   END $$;`,
  `ALTER TABLE team_members
     ADD COLUMN IF NOT EXISTS access_level team_access_level DEFAULT 'keine';`,
  `UPDATE team_members SET access_level = 'keine' WHERE access_level IS NULL;`,
  `ALTER TABLE team_members ALTER COLUMN access_level SET DEFAULT 'keine';`,
  `ALTER TABLE team_members ALTER COLUMN access_level SET NOT NULL;`,
  // Performance-Indizes für die Schichten-Tabelle: Monatsliste (GET /shifts),
  // Duplikatprüfung (DATE-Abfragen) und Überschneidungsprüfung nutzen jetzt
  // sargable Bereichsfilter, die diese Indizes verwenden können.
  // Ohne diese Indizes prüft PostgreSQL bei wachsendem Bestand jede Zeile.
  `CREATE INDEX IF NOT EXISTS shifts_team_id_start_time_idx
     ON shifts (team_id, start_time);`,
  `CREATE INDEX IF NOT EXISTS shifts_user_id_start_time_idx
     ON shifts (user_id, start_time);`,
  // Partieller Index für Aushilfe-Spiegel (einsatz_team_id): Bitmap-OR-Scan
  // auf (team_id OR einsatz_team_id) IN teamScope. Nur für Zeilen mit
  // gesetztem einsatz_team_id, damit der Index klein und effektiv bleibt.
  // Guard: läuft VOR dem Schema-Push; auf einer frischen DB existiert die
  // shifts-Tabelle noch nicht — daher IF-EXISTS-Wrapper. Frische DBs erhalten
  // den Index über das deklarative Drizzle-Schema (s. shifts.ts).
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_name = 'shifts' AND table_schema = 'public') THEN
       CREATE INDEX IF NOT EXISTS shifts_einsatz_team_id_start_time_idx
         ON shifts (einsatz_team_id, start_time)
         WHERE einsatz_team_id IS NOT NULL;
     END IF;
   END $$;`,
  // Performance-Indexes für contracts: Monatsüberschneidungs-Abfragen
  // (contractForMonth, activeContractsForUsers) filtern auf
  // user_id + start_date <= X und end_date >= Y. Ohne diese Indizes
  // führt PostgreSQL bei wachsendem Bestand einen Seq-Scan durch.
  // CONCURRENTLY: kein Tabellen-Lock im laufenden Betrieb.
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS contracts_user_id_start_date_idx
     ON contracts (user_id, start_date);`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS contracts_user_id_end_date_idx
     ON contracts (user_id, end_date);`,
  // Performance-Indexes für time_tracking: Monatslisten (Dashboard/hours-balance)
  // filtern auf team_id IN (...) AND actual_start BETWEEN. Der Index auf
  // (team_id, actual_start) aktiviert den bestehenden Index-Nutzen.
  // (user_id, actual_start) beschleunigt den Assistenten-Branch des Dashboards.
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS time_tracking_team_id_actual_start_idx
     ON time_tracking (team_id, actual_start);`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS time_tracking_user_id_actual_start_idx
     ON time_tracking (user_id, actual_start);`,
  // data_migrations (Einmal-Marker-Tabelle, s. backfill-partial-absence-flag):
  // eine EINZELNE neue Tabelle auf einer bereits befüllten Bestands-DB lässt
  // drizzle-kit push interaktiv nachfragen, ob sie neu ist oder eine
  // bestehende Tabelle umbenennt (TTY-Prompt, "Interactive prompts require a
  // TTY"). Auf einer frischen DB (alle Tabellen neu zugleich) tritt das nicht
  // auf — nur wenn genau eine Tabelle gegen einen sonst unveränderten
  // Bestand hinzukommt. Deshalb vorab idempotent anlegen, exakt wie im
  // Drizzle-Schema (data_migrations.ts).
  `CREATE TABLE IF NOT EXISTS data_migrations (
     name text PRIMARY KEY,
     applied_at timestamp DEFAULT now() NOT NULL
   );`,
  // Gemeinsame Generation für den serverseitigen Stundenbilanz-Cache.
  // Die einzelne neue Tabelle vorab anzulegen verhindert auf Bestands-DBs
  // den interaktiven Rename-Prompt von drizzle-kit.
  `CREATE TABLE IF NOT EXISTS hours_balance_cache_versions (
     id integer PRIMARY KEY DEFAULT 1,
     version bigint DEFAULT 0 NOT NULL
   );`,
  `INSERT INTO hours_balance_cache_versions (id, version)
     VALUES (1, 0)
     ON CONFLICT (id) DO NOTHING;`,
  // absence_requests (#887, Urlaubs-/Krankheitsanträge mit Bestätigungspflicht):
  // ZWEI neue Enum-Typen PLUS eine neue Tabelle mit mehreren FKs auf einer
  // bestehenden, befüllten Bestands-DB — genau die Kombination, bei der
  // drizzle-kit push ohne TTY interaktiv nachfragen kann (Rename/Create-
  // Prompt). Daher vorab idempotent anlegen, exakt wie im Drizzle-Schema
  // (absence_requests.ts).
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'absence_request_type') THEN
       CREATE TYPE absence_request_type AS ENUM ('vacation', 'sick');
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'absence_request_status') THEN
       CREATE TYPE absence_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
     END IF;
   END $$;`,
  `CREATE TABLE IF NOT EXISTS absence_requests (
     id serial PRIMARY KEY,
     team_id integer NOT NULL,
     user_id integer NOT NULL,
     type absence_request_type NOT NULL,
     status absence_request_status NOT NULL DEFAULT 'PENDING',
     days jsonb NOT NULL,
     notes jsonb,
     created_at timestamp NOT NULL DEFAULT now(),
     resolved_at timestamp,
     resolved_by_user_id integer,
     result_shift_ids jsonb
   );`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'absence_requests_team_id_teams_id_fk') THEN
       ALTER TABLE absence_requests
         ADD CONSTRAINT absence_requests_team_id_teams_id_fk
         FOREIGN KEY (team_id) REFERENCES teams(id);
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'absence_requests_user_id_users_id_fk') THEN
       ALTER TABLE absence_requests
         ADD CONSTRAINT absence_requests_user_id_users_id_fk
         FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'absence_requests_resolved_by_user_id_users_id_fk') THEN
       ALTER TABLE absence_requests
         ADD CONSTRAINT absence_requests_resolved_by_user_id_users_id_fk
         FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
     END IF;
   END $$;`,
  `CREATE INDEX IF NOT EXISTS absence_requests_team_status_idx
     ON absence_requests (team_id, status);`,
  `CREATE INDEX IF NOT EXISTS absence_requests_user_status_idx
     ON absence_requests (user_id, status);`,
  // Löschschutz für Zeitnachweise (§ 16 ArbZG, § 17 MiLoG, 2 Jahre
  // Aufbewahrungspflicht): shifts/absence_requests/contracts/time_tracking
  // verlieren ON DELETE CASCADE auf user_id. Löschen einer Assistenzkraft darf
  // ihre Dienste/Anträge/Verträge/Ist-Zeiten nicht automatisch mitreißen.
  // DELETE /users/:id faengt die resultierende FK-Verletzung (23503) bereits
  // als 409 ab — kein Verhaltenswechsel für den Aufrufer. Konstraint-Name
  // bleibt gleich, nur die ON-DELETE-Klausel aendert sich: unconditional
  // Drop+Recreate ist sicher bei jedem Lauf (Tabelle existiert zu dem
  // Zeitpunkt bereits — diese Migrationen laufen nach den entsprechenden
  // CREATE-TABLE-Vorab-Schritten weiter oben).
  `ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_user_id_users_id_fk;`,
  `ALTER TABLE shifts ADD CONSTRAINT shifts_user_id_users_id_fk
     FOREIGN KEY (user_id) REFERENCES users(id);`,
  `ALTER TABLE absence_requests DROP CONSTRAINT IF EXISTS absence_requests_user_id_users_id_fk;`,
  `ALTER TABLE absence_requests ADD CONSTRAINT absence_requests_user_id_users_id_fk
     FOREIGN KEY (user_id) REFERENCES users(id);`,
  `ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_user_id_users_id_fk;`,
  `ALTER TABLE contracts ADD CONSTRAINT contracts_user_id_users_id_fk
     FOREIGN KEY (user_id) REFERENCES users(id);`,
  `ALTER TABLE time_tracking DROP CONSTRAINT IF EXISTS time_tracking_user_id_users_id_fk;`,
  `ALTER TABLE time_tracking ADD CONSTRAINT time_tracking_user_id_users_id_fk
     FOREIGN KEY (user_id) REFERENCES users(id);`,
  // shift_changes (Änderungshistorie für bereits bestätigte Dienste): NEUER
  // Enum-Typ PLUS neue Tabelle mit mehreren FKs auf einer bestehenden,
  // befüllten Bestands-DB — dieselbe Kombination wie bei absence_requests
  // oben, bei der drizzle-kit push ohne TTY interaktiv nachfragen kann.
  // Daher vorab idempotent anlegen, exakt wie im Drizzle-Schema
  // (shift_changes.ts).
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_change_source') THEN
       CREATE TYPE shift_change_source AS ENUM ('planner_edit', 'deviation_accepted');
     END IF;
   END $$;`,
  `CREATE TABLE IF NOT EXISTS shift_changes (
     id serial PRIMARY KEY,
     shift_id integer NOT NULL,
     team_id integer NOT NULL,
     user_id integer NOT NULL,
     changed_by integer NOT NULL,
     change_source shift_change_source NOT NULL,
     before jsonb NOT NULL,
     after jsonb NOT NULL,
     created_at timestamp DEFAULT now() NOT NULL
   );`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_changes_shift_id_shifts_id_fk') THEN
       ALTER TABLE shift_changes
         ADD CONSTRAINT shift_changes_shift_id_shifts_id_fk
         FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_changes_team_id_teams_id_fk') THEN
       ALTER TABLE shift_changes
         ADD CONSTRAINT shift_changes_team_id_teams_id_fk
         FOREIGN KEY (team_id) REFERENCES teams(id);
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_changes_user_id_users_id_fk') THEN
       ALTER TABLE shift_changes
         ADD CONSTRAINT shift_changes_user_id_users_id_fk
         FOREIGN KEY (user_id) REFERENCES users(id);
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_changes_changed_by_users_id_fk') THEN
       ALTER TABLE shift_changes
         ADD CONSTRAINT shift_changes_changed_by_users_id_fk
         FOREIGN KEY (changed_by) REFERENCES users(id);
     END IF;
   END $$;`,
  `CREATE INDEX IF NOT EXISTS shift_changes_shift_id_idx ON shift_changes (shift_id);`,
  `CREATE INDEX IF NOT EXISTS shift_changes_user_id_created_at_idx ON shift_changes (user_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS shift_changes_team_id_created_at_idx ON shift_changes (team_id, created_at);`,
  // shift_deviation_reports (Abweichungsmodell): gleiche TTY-Prompt-Gefahr wie
  // shift_changes/absence_requests oben — vorab idempotent anlegen, exakt wie
  // im Drizzle-Schema (shift_deviation_reports.ts).
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_deviation_status') THEN
       CREATE TYPE shift_deviation_status AS ENUM ('PENDING', 'ACCEPTED', 'DISPUTED');
     END IF;
   END $$;`,
  `CREATE TABLE IF NOT EXISTS shift_deviation_reports (
     id serial PRIMARY KEY,
     shift_id integer NOT NULL,
     team_id integer NOT NULL,
     user_id integer NOT NULL,
     status shift_deviation_status NOT NULL DEFAULT 'PENDING',
     reported_start_time timestamp NOT NULL,
     reported_end_time timestamp NOT NULL,
     reported_pause_minutes integer NOT NULL DEFAULT 0,
     reported_ausgefallen boolean NOT NULL DEFAULT false,
     reported_at timestamp DEFAULT now() NOT NULL,
     resolved_by integer,
     resolved_at timestamp,
     dispute_reason text
   );`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_deviation_reports_shift_id_shifts_id_fk') THEN
       ALTER TABLE shift_deviation_reports
         ADD CONSTRAINT shift_deviation_reports_shift_id_shifts_id_fk
         FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_deviation_reports_team_id_teams_id_fk') THEN
       ALTER TABLE shift_deviation_reports
         ADD CONSTRAINT shift_deviation_reports_team_id_teams_id_fk
         FOREIGN KEY (team_id) REFERENCES teams(id);
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_deviation_reports_user_id_users_id_fk') THEN
       ALTER TABLE shift_deviation_reports
         ADD CONSTRAINT shift_deviation_reports_user_id_users_id_fk
         FOREIGN KEY (user_id) REFERENCES users(id);
     END IF;
   END $$;`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_deviation_reports_resolved_by_users_id_fk') THEN
       ALTER TABLE shift_deviation_reports
         ADD CONSTRAINT shift_deviation_reports_resolved_by_users_id_fk
         FOREIGN KEY (resolved_by) REFERENCES users(id);
     END IF;
   END $$;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS shift_deviation_reports_shift_id_unique ON shift_deviation_reports (shift_id);`,
  `CREATE INDEX IF NOT EXISTS shift_deviation_reports_team_id_status_idx ON shift_deviation_reports (team_id, status);`,
  `CREATE INDEX IF NOT EXISTS shift_deviation_reports_user_id_idx ON shift_deviation_reports (user_id);`,
];

/** Alle Vorab-Schritte sequenziell gegen den übergebenen Client ausführen. */
export async function runPrePushSql(client: {
  query: (sql: string) => Promise<unknown>;
}): Promise<void> {
  for (const stmt of PRE_PUSH_SQL) {
    await client.query(stmt);
  }
}
