import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

/**
 * Vergleicht den IST-Zustand einer Datenbank (gedacht: die `_test`-DB) mit dem
 * aktuellen Drizzle-Schema: Sind ALLE erwarteten Tabellen und Spalten da?
 *
 * Bewusst als eigener Export-Pfad (`@workspace/db/verify-schema`) OHNE den
 * Pool-Seiteneffekt des Haupt-Index: Aufrufer (z. B. die Playwright-Config
 * beim Config-Load) geben die Ziel-URL explizit mit und oeffnen keinen
 * Pool gegen die Dev-DB.
 *
 * Rueckgabe: Liste der Abweichungen (leer = Schema vollstaendig).
 * Wirft bei Verbindungsfehlern — fuer Aufrufer ist das genauso ein
 * "bitte provisionieren"-Signal wie eine nicht-leere Liste.
 *
 * Bewusst nur "fehlt etwas?" geprueft (keine Typ-/Extra-Spalten-Pruefung):
 * ueberzaehlige Spalten machen keine Specs rot, fehlende schon.
 */
export async function findMissingSchemaObjects(
  databaseUrl: string,
): Promise<string[]> {
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

  // Explizite Zeitlimits: der alte Kindprozess-Weg hatte ein 120s-Timeout;
  // in-process darf der Check den Config-Load ebenfalls nie unbegrenzt
  // blockieren. Zeitüberschreitung wirft -> Aufrufer provisioniert.
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 15_000,
    query_timeout: 30_000,
  });
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
    return problems;
  } finally {
    await client.end();
  }
}

/** Anzahl der Tabellen im Drizzle-Schema (fuer Erfolgs-Logs der Aufrufer). */
export function countSchemaTables(): number {
  let n = 0;
  for (const value of Object.values(schema)) {
    if (value instanceof PgTable) n++;
  }
  return n;
}
