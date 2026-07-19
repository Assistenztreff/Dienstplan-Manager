import { getTableConfig } from "drizzle-orm/pg-core";
import { PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "@workspace/db/schema";

/**
 * Prüft, ob die per DATABASE_URL angegebene Datenbank (gedacht: die `_test`-DB)
 * ALLE Tabellen und Spalten des aktuellen Drizzle-Schemas enthält.
 *
 * Zweck (Task #499): Der Schema-Hash-Marker in der Playwright-Config beweist
 * nur "setup-test-db lief mit diesen Quelldateien" — NICHT, dass die Test-DB
 * tatsächlich auf dem Stand ist. Drift (Marker aus anderem Kontext, still
 * fehlgeschlagener Push, manuelle Eingriffe) führte wiederholt zu 500ern
 * ("column ... does not exist") und manuellen SQL-Reparaturen. Dieser Check
 * vergleicht den IST-Zustand der DB direkt mit dem Drizzle-Schema.
 *
 * Exit 0: alle erwarteten Tabellen/Spalten vorhanden.
 * Exit 1: Abweichung gefunden ODER DB nicht erreichbar/nicht vorhanden —
 *         der Aufrufer soll dann setup-test-db (mit Selbstheilung) ausführen.
 *
 * Bewusst nur "fehlt etwas?" geprüft (keine Typ-/Extra-Spalten-Prüfung):
 * überzählige Spalten machen keine Specs rot, fehlende schon.
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL muss gesetzt sein (erwartet: die _test-DB).");
  }

  // Erwartete Struktur aus dem Drizzle-Schema ableiten.
  const expected = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const cfg = getTableConfig(value);
    const cols = new Set<string>();
    for (const col of cfg.columns) cols.add(col.name);
    expected.set(cfg.name, cols);
  }
  if (expected.size === 0) {
    throw new Error("Keine Tabellen im Drizzle-Schema gefunden — Check defekt?");
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );
    const actual = new Map<string, Set<string>>();
    for (const row of res.rows) {
      let cols = actual.get(row.table_name);
      if (!cols) {
        cols = new Set();
        actual.set(row.table_name, cols);
      }
      cols.add(row.column_name);
    }

    const problems: string[] = [];
    for (const [table, cols] of expected) {
      const actualCols = actual.get(table);
      if (!actualCols) {
        problems.push(`Tabelle fehlt: ${table}`);
        continue;
      }
      for (const col of cols) {
        if (!actualCols.has(col)) {
          problems.push(`Spalte fehlt: ${table}.${col}`);
        }
      }
    }

    if (problems.length > 0) {
      console.error(
        `Test-DB-Schema veraltet (${problems.length} Abweichung(en) gegenüber dem Drizzle-Schema):`,
      );
      for (const p of problems) console.error(`  - ${p}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Test-DB-Schema aktuell: ${expected.size} Tabellen, alle erwarteten Spalten vorhanden.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // Auch "DB nicht erreichbar / existiert nicht" ist für den Aufrufer ein
  // "bitte provisionieren"-Signal, kein harter Infrastrukturfehler.
  console.error("Test-DB-Schema-Check fehlgeschlagen:", err);
  process.exit(1);
});
