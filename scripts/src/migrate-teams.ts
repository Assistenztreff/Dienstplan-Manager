import "./lib/normalize-db-url";
import pg from "pg";

/**
 * Idempotente Migration für die Multi-Team-Struktur.
 *
 * Muss VOR `drizzle-kit push` laufen: push ist non-interaktiv und kann keine
 * NOT-NULL-Spalte ohne Default zu befüllten Tabellen hinzufügen. Dieses Script
 * legt die Tabellen/Spalten an, befüllt sie und setzt erst danach NOT NULL —
 * danach sieht push keine Änderung mehr.
 *
 * Idempotent: mehrfaches Ausführen ist gefahrlos.
 */

const DATA_TABLES = ["shifts", "contracts", "shift_models", "time_tracking"] as const;

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");

    // account_type Enum + Spalte (Default => push-sicher, kein Backfill nötig)
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "account_type" AS ENUM ('privat', 'dienstleister');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await client.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "account_type" "account_type" DEFAULT 'privat' NOT NULL;`,
    );

    // teams
    await client.query(`
      CREATE TABLE IF NOT EXISTS "teams" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "owner_id" integer NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "teams" ADD CONSTRAINT "teams_owner_id_users_id_fk"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // team_members
    await client.query(`
      CREATE TABLE IF NOT EXISTS "team_members" (
        "id" serial PRIMARY KEY NOT NULL,
        "team_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk"
          FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'team_members_team_id_user_id_unique'
        ) THEN
          ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_user_id_unique"
            UNIQUE ("team_id", "user_id");
        END IF;
      EXCEPTION WHEN duplicate_object OR duplicate_table THEN null; END $$;
    `);

    // team_id Spalten (zunächst nullable, damit befüllbar)
    for (const table of DATA_TABLES) {
      await client.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "team_id" integer;`);
    }

    // Standard-Team anlegen, falls noch keines existiert und ein Admin vorhanden ist
    await client.query(`
      INSERT INTO "teams" ("name", "owner_id")
      SELECT 'Standard-Team', (SELECT "id" FROM "users" WHERE "role" = 'admin' ORDER BY "id" LIMIT 1)
      WHERE EXISTS (SELECT 1 FROM "users" WHERE "role" = 'admin')
        AND NOT EXISTS (SELECT 1 FROM "teams");
    `);

    // Backfill: bestehende Daten dem Standard-Team (ältestes Team) zuordnen
    for (const table of DATA_TABLES) {
      await client.query(`
        UPDATE "${table}"
        SET "team_id" = (SELECT "id" FROM "teams" ORDER BY "id" LIMIT 1)
        WHERE "team_id" IS NULL AND EXISTS (SELECT 1 FROM "teams");
      `);
    }

    // Mitgliedschaften-Backfill NUR als Bootstrap fuer Alt-Daten aus der
    // Vor-Team-Aera: ausschliesslich Nutzer, die noch in KEINEM Team Mitglied
    // sind, werden dem ersten Team zugeordnet. WICHTIG: Frueher stand hier
    // "jeder Nutzer gehoert zum Standard-Team" (Pruefung nur gegen das erste
    // Team) — da dieses Skript bei JEDEM Task-Merge laeuft, hat das die per
    // setup-test-accounts eingerichtete Team-Trennung bei jedem Merge wieder
    // zerstoert (alle Testkonten/Dummys landeten erneut in Team 1 und sahen
    // dort fremde Daten). Nutzer mit irgendeiner bestehenden Mitgliedschaft
    // duerfen hier NIE zusaetzlich ins erste Team eingefuegt werden.
    await client.query(`
      INSERT INTO "team_members" ("team_id", "user_id")
      SELECT (SELECT "id" FROM "teams" ORDER BY "id" LIMIT 1), u."id"
      FROM "users" u
      WHERE EXISTS (SELECT 1 FROM "teams")
        AND NOT EXISTS (
          SELECT 1 FROM "team_members" tm
          WHERE tm."user_id" = u."id"
        );
    `);

    // Backfill-Invariante (für strikte Datentrennung, #44): jeder Nutzer mit
    // Domänendaten in einem Team MUSS dort Mitglied sein. Heilt Nutzer, die nach
    // der Erst-Migration, aber vor der Mitgliedschaft-bei-Anlage angelegt wurden
    // (sie hätten sonst Schichten/Verträge/Zeiten in einem Team ohne Mitgliedschaft
    // und könnten keine neuen Datensätze mehr erhalten).
    for (const table of ["shifts", "contracts", "time_tracking"] as const) {
      await client.query(`
        INSERT INTO "team_members" ("team_id", "user_id")
        SELECT DISTINCT t."team_id", t."user_id"
        FROM "${table}" t
        WHERE t."team_id" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "team_members" tm
            WHERE tm."user_id" = t."user_id" AND tm."team_id" = t."team_id"
          );
      `);
    }

    // NOT NULL + FK erst setzen, wenn keine NULLs mehr vorhanden sind
    for (const table of DATA_TABLES) {
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM "${table}" WHERE "team_id" IS NULL) THEN
            ALTER TABLE "${table}" ALTER COLUMN "team_id" SET NOT NULL;
          END IF;
        END $$;
      `);
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE "${table}" ADD CONSTRAINT "${table}_team_id_teams_id_fk"
            FOREIGN KEY ("team_id") REFERENCES "teams"("id");
        EXCEPTION WHEN duplicate_object THEN null; END $$;
      `);
    }

    // Alt-Zaehler der Urlaubstage entfernen: Urlaub wird stundengenau in
    // vacation_hours_used gefuehrt (Tage = Stunden / vacationHoursPerDay).
    // Die Spalte wurde nicht mehr beschrieben und lieferte veraltete Werte.
    // Drop hier (VOR drizzle push), damit push keine interaktive
    // Datenverlust-Rueckfrage stellt. Idempotent via IF EXISTS.
    await client.query(`ALTER TABLE "contracts" DROP COLUMN IF EXISTS "vacation_days_used";`);

    await client.query("COMMIT");
    console.log("Multi-Team-Migration abgeschlossen.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler bei Multi-Team-Migration:", err);
  process.exit(1);
});
