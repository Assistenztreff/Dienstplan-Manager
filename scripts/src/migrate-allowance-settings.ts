import pg from "pg";

/**
 * Migriert die Zuschlags-Einstellungen von der globalen Singleton-Zeile (id=1)
 * auf PRO-KONTO-Zeilen (owner_id = Team-Eigentümer/Admin).
 *
 * Hintergrund: Die Prozente/Nachtfenster lagen als eine globale Zeile in der DB
 * — jedes Admin-Konto konnte damit die Auswertungen ALLER anderen Konten
 * mitändern (Multi-Tenant-Leck). Neu ist eine Zeile je Admin-Konto.
 *
 * Bestandsdaten: Die bisherigen globalen Werte werden als Startwerte für alle
 * vorhandenen Admin-Konten übernommen (keine Neuberechnung gespeicherter
 * Roh-Stunden nötig — Prozente wirken erst beim Abruf).
 *
 * Idempotent und ohne interaktive Prompts (läuft im Post-Merge ohne TTY, VOR
 * `db push`, damit push keine interaktiven Rückfragen zu NOT NULL/UNIQUE stellt):
 * 1. Spalte owner_id nachrüsten (nullable).
 * 2. id-Spalte auf Sequenz umstellen (war: Default 1) + Singleton-Check droppen.
 * 3. Je Admin-Konto ohne eigene Zeile eine Zeile aus den Alt-Werten (oder
 *    Defaults) anlegen.
 * 4. Alt-Zeile(n) ohne owner_id löschen, dann NOT NULL + UNIQUE + FK setzen.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const tableExists = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'allowance_settings'"
    );
    if (tableExists.rowCount === 0) {
      // Frische DB: db push legt die Tabelle direkt im Zielzustand an.
      console.log("allowance_settings existiert noch nicht — nichts zu migrieren.");
      return;
    }

    // 1. owner_id-Spalte nachrüsten (nullable, NOT NULL erst nach Backfill).
    await client.query(
      "ALTER TABLE allowance_settings ADD COLUMN IF NOT EXISTS owner_id integer"
    );

    // 2. id auf Sequenz umstellen (alt: DEFAULT 1) + Singleton-Check entfernen.
    await client.query(
      "CREATE SEQUENCE IF NOT EXISTS allowance_settings_id_seq"
    );
    await client.query(
      "SELECT setval('allowance_settings_id_seq', COALESCE((SELECT MAX(id) FROM allowance_settings), 0) + 1, false)"
    );
    await client.query(
      "ALTER TABLE allowance_settings ALTER COLUMN id SET DEFAULT nextval('allowance_settings_id_seq')"
    );
    await client.query(
      "ALTER SEQUENCE allowance_settings_id_seq OWNED BY allowance_settings.id"
    );
    await client.query(
      "ALTER TABLE allowance_settings DROP CONSTRAINT IF EXISTS allowance_settings_singleton"
    );

    // 3. Backfill: je Admin-Konto ohne eigene Zeile eine Zeile mit den Werten
    //    der alten globalen Zeile (Fallback: Defaults) anlegen.
    const seeded = await client.query(`
      INSERT INTO allowance_settings
        (owner_id, night_percent, night_start, night_end, sunday_percent, holiday_percent, state, updated_at)
      SELECT
        u.id,
        COALESCE(g.night_percent, 25),
        COALESCE(g.night_start, '23:00'),
        COALESCE(g.night_end, '06:00'),
        COALESCE(g.sunday_percent, 50),
        COALESCE(g.holiday_percent, 100),
        g.state,
        NOW()
      FROM users u
      LEFT JOIN LATERAL (
        SELECT night_percent, night_start, night_end, sunday_percent, holiday_percent, state
        FROM allowance_settings
        WHERE owner_id IS NULL
        ORDER BY id
        LIMIT 1
      ) g ON true
      WHERE u.role = 'admin'
        AND NOT EXISTS (
          SELECT 1 FROM allowance_settings a WHERE a.owner_id = u.id
        )
    `);
    console.log(`Zuschlags-Zeilen für ${seeded.rowCount} Admin-Konto/-Konten angelegt.`);

    // 4. Alt-Zeile(n) entfernen, dann Constraints setzen.
    await client.query("DELETE FROM allowance_settings WHERE owner_id IS NULL");
    await client.query(
      "ALTER TABLE allowance_settings ALTER COLUMN owner_id SET NOT NULL"
    );
    // UNIQUE + FK idempotent (42P07/42710 = existiert bereits).
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowance_settings_owner_id_unique') THEN
        ALTER TABLE allowance_settings ADD CONSTRAINT allowance_settings_owner_id_unique UNIQUE (owner_id);
      END IF;
    END $$`);
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowance_settings_owner_id_users_id_fk') THEN
        ALTER TABLE allowance_settings
          ADD CONSTRAINT allowance_settings_owner_id_users_id_fk
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $$`);

    console.log("Zuschlags-Einstellungen erfolgreich auf Pro-Konto-Zeilen migriert.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration fehlgeschlagen:", err);
  process.exit(1);
});
