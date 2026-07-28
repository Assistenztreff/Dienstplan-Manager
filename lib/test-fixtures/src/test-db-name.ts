/**
 * Zentrale Namenslogik fuer die isolierten E2E-/Test-Datenbanken (Task #633).
 *
 * Bisher teilten sich ALLE Umgebungen (Haupt-Repl + parallele Task-
 * Umgebungen) EINE `<dbname>_test`-DB auf dem Staging-Postgres und mussten
 * sich deshalb ueber den Lauf-uebergreifenden Advisory-Lock serialisieren
 * (stundenlange Wartezeiten bei mehreren parallelen Aufgaben).
 *
 * Neu: Jede Umgebung bekommt standardmaessig ihre EIGENE private Wegwerf-DB
 * `<dbname>_test_<suffix>`. Der Suffix ist pro Umgebung STABIL (Hash der
 * Umgebungs-Identitaet), damit die einmal provisionierte DB ueber Laeufe
 * hinweg wiederverwendet wird und die Setup-Kosten nicht bei jedem Lauf
 * anfallen.
 *
 * Schalter:
 *   - `E2E_SHARED_TEST_DB=1`  -> altes Verhalten (geteilte `<dbname>_test`,
 *     Advisory-Lock aktiv). Fallback, falls private DBs Probleme machen.
 *   - `E2E_TEST_DB_SUFFIX=abc123` -> expliziter Suffix (nur [a-z0-9]{1,16}),
 *     z. B. um einen zweiten parallelen Lauf IN DERSELBEN Umgebung zu
 *     simulieren.
 *
 * Alters-Nachweis fuer die Selbstaufraeumung OHNE Zusatztabelle: Eine Tabelle
 * in der Test-DB wuerde `drizzle-kit push` als "zu loeschen" auffallen (vgl.
 * Memory: session-Tabelle) und eine Registry in der Staging-DB haette dasselbe
 * Problem. Stattdessen traegt jede private DB einen Datenbank-KOMMENTAR
 * (`COMMENT ON DATABASE`, lebt in pg_shdescription, stoert kein Schema) mit
 * dem letzten Nutzungszeitpunkt. Verwaiste DBs (Kommentar aelter als die
 * Schwelle, keine aktiven Verbindungen) werden beim naechsten Lauf einer
 * beliebigen Umgebung geloescht.
 */

import { createHash } from "node:crypto";
import { hostname } from "node:os";
import pg from "pg";

export const TEST_DB_SUFFIX_PATTERN = /^[a-z0-9]{1,16}$/;

/** Kommentar-Marker: nur DBs mit diesem Praefix gelten als von uns verwaltet. */
const COMMENT_PREFIX = "dienstplan-e2e";

/**
 * Ermittelt den Suffix fuer die private Test-DB dieser Umgebung.
 * Leerer String = geteilte `<dbname>_test` (Fallback-Modus).
 */
export function resolveTestDbSuffix(env: NodeJS.ProcessEnv = process.env): string {
  if (env.E2E_SHARED_TEST_DB === "1") return "";
  const explicit = env.E2E_TEST_DB_SUFFIX?.trim().toLowerCase();
  if (explicit) {
    if (!TEST_DB_SUFFIX_PATTERN.test(explicit)) {
      throw new Error(
        `E2E_TEST_DB_SUFFIX "${explicit}" ist ungueltig — erlaubt: ${TEST_DB_SUFFIX_PATTERN} (Sicherheits-Whitelist fuer DROP DATABASE).`,
      );
    }
    return explicit;
  }
  // Stabile Umgebungs-Identitaet: REPL_ID ist pro (Task-)Umgebung eindeutig
  // und stabil; Hostname als Fallback ausserhalb von Replit.
  const identity = env.REPL_ID || hostname();
  if (!identity) return "";
  return createHash("sha256")
    .update(`dienstplan-test-db:${identity}`)
    .digest("hex")
    .slice(0, 10);
}

export interface TestDbTarget {
  /** Vollstaendige URL der Test-DB. */
  url: string;
  /** Name der Test-DB (`<dbname>_test` oder `<dbname>_test_<suffix>`). */
  name: string;
  /** Name der Basis-DB (Dev/Staging), aus der abgeleitet wurde. */
  baseName: string;
  /** Aktiver Suffix ("" = geteilte DB). */
  suffix: string;
  /** true = private Wegwerf-DB dieser Umgebung (kein Advisory-Lock noetig). */
  isPrivate: boolean;
}

/**
 * Leitet aus einer (bereits normalisierten) Basis-`DATABASE_URL` das Test-DB-
 * Ziel ab. Der Suffix kommt standardmaessig aus `resolveTestDbSuffix()`,
 * damit ALLE Ableitungsstellen (Playwright-Config, setup-test-db,
 * verify-checks, db-backed Vitest) konsistent dieselbe DB treffen.
 */
export function deriveTestDbTarget(
  base: string,
  suffix: string = resolveTestDbSuffix(),
): TestDbTarget {
  const u = new URL(base);
  const baseName = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const name = suffix ? `${baseName}_test_${suffix}` : `${baseName}_test`;
  u.pathname = `/${name}`;
  return { url: u.toString(), name, baseName, suffix, isPrivate: suffix !== "" };
}

/**
 * Stempelt den Nutzungszeitpunkt der Test-DB in ihren Datenbank-Kommentar.
 * Best effort: Fehler (z. B. fremder Owner) werden gemeldet, brechen aber
 * nichts ab — dann bleibt die DB schlimmstenfalls laenger stehen.
 */
export async function touchTestDbComment(
  baseDatabaseUrl: string,
  dbName: string,
  log: (m: string) => void = console.log,
): Promise<void> {
  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  try {
    await client.connect();
    // Identifier-Quoting: dbName stammt aus deriveTestDbTarget (Whitelist).
    const comment = `${COMMENT_PREFIX} used=${new Date().toISOString()}`;
    await client.query(`COMMENT ON DATABASE "${dbName}" IS '${comment}'`);
  } catch (err) {
    log(
      `[test-db] Nutzungs-Stempel fuer "${dbName}" konnte nicht gesetzt werden (unkritisch): ${err instanceof Error ? err.message : err}`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Raeumt verwaiste private Test-DBs anderer (verschwundener) Umgebungen weg.
 *
 * Sicherheits-Leitplanken (in dieser Reihenfolge geprueft):
 *   1. Name matcht STRIKT `^<baseName>_test_[a-z0-9]{1,16}$` — niemals die
 *      Basis-DB, niemals die geteilte `<baseName>_test`, niemals fremde DBs.
 *   2. Nie die eigene DB (`ownName`).
 *   3. Nur DBs MIT unserem Kommentar-Marker; ohne Marker -> unbekannte
 *      Herkunft -> nicht anfassen. (Frisch in Provisionierung befindliche DBs
 *      bekommen den Marker unmittelbar nach CREATE, s. setup-test-db.)
 *   4. Nutzungs-Stempel aelter als `maxAgeMs` (Default 72h).
 *   5. Keine aktiven Verbindungen.
 * Drops sind best effort — verliert dieser Prozess ein Rennen gegen eine
 * andere Umgebung, wird der Fehler nur geloggt.
 */
export async function cleanupStaleTestDbs(
  baseDatabaseUrl: string,
  options: {
    baseName: string;
    ownName: string;
    maxAgeMs?: number;
    log?: (m: string) => void;
  },
): Promise<void> {
  const { baseName, ownName } = options;
  const maxAgeMs = options.maxAgeMs ?? 72 * 60 * 60 * 1000;
  const log = options.log ?? console.log;
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const allowed = new RegExp(`^${escaped}_test_[a-z0-9]{1,16}$`);

  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  try {
    await client.connect();
    const rows = await client.query<{ datname: string; comment: string | null }>(
      `SELECT d.datname, sd.description AS comment
         FROM pg_database d
         LEFT JOIN pg_shdescription sd ON sd.objoid = d.oid AND sd.classoid = 'pg_database'::regclass
        WHERE d.datname LIKE $1`,
      [`${baseName}\\_test\\_%`],
    );
    for (const row of rows.rows) {
      const name = row.datname;
      if (!allowed.test(name) || name === ownName) continue;
      if (!row.comment?.startsWith(COMMENT_PREFIX)) continue;
      const match = /used=([0-9T:.\-Z+]+)/.exec(row.comment);
      const usedAt = match ? Date.parse(match[1]) : Number.NaN;
      if (!Number.isFinite(usedAt) || Date.now() - usedAt < maxAgeMs) continue;
      const active = await client.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1",
        [name],
      );
      if ((active.rows[0]?.n ?? 1) > 0) continue;
      try {
        await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        log(
          `[test-db] Verwaiste Test-DB "${name}" entfernt (zuletzt genutzt ${match?.[1]}).`,
        );
      } catch (err) {
        log(
          `[test-db] Verwaiste Test-DB "${name}" konnte nicht entfernt werden (unkritisch): ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  } catch (err) {
    log(
      `[test-db] Aufraeumen verwaister Test-DBs uebersprungen (unkritisch): ${err instanceof Error ? err.message : err}`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}
