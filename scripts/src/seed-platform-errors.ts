import "./lib/normalize-db-url";
import pg from "pg";
import { RETENTION_SEED_CONTEXT } from "@workspace/test-fixtures";

/**
 * Seedet oder entfernt kuenstliche Eintraege in `platform_errors` — NUR fuer
 * Test-Infrastruktur (E2E-Regressionstest des Retention-Hinweises im
 * Operator-Dashboard, Karte "Fehler-Tracking").
 *
 * Hintergrund: Der Hinweis "Aufbewahrungslimit erreicht" (data-testid
 * `text-error-retention-notice`) erscheint erst, wenn die Tabelle das
 * serverseitige Limit (MAX_STORED_ERRORS, Default 500) erreicht hat
 * (`totalStored >= retentionLimit` in GET /api/operator/errors). Um das im
 * E2E-Test zu pruefen, muessen viele Zeilen direkt in die (Test-)DB geseedet
 * werden — ueber die API waere das langsam und wuerde Warn-Mails ausloesen.
 *
 * Aufruf ueber Umgebungsvariablen (analog set-plan/delete-account), damit der
 * Test per execSync mit ueberschriebener DATABASE_URL (Test-DB) arbeiten kann:
 *   SEED_PLATFORM_ERRORS_PREFIX  – eindeutiger Meldungs-Praefix (Pflicht);
 *                                  MUSS lauf-eindeutig sein, Cleanup loescht
 *                                  ausschliesslich Zeilen mit diesem Praefix.
 *   SEED_PLATFORM_ERRORS_COUNT   – Anzahl zu seedender Zeilen (Pflicht im
 *                                  Seed-Modus, positive Ganzzahl).
 *   SEED_PLATFORM_ERRORS_CLEANUP – "1" => Cleanup-Modus: loescht alle Zeilen,
 *                                  deren message mit dem Praefix beginnt.
 *
 * Jede geseedete Zeile bekommt eine EIGENE Meldung (`<prefix> #<n>`), damit
 * die Buendelungs-Logik (gleiche Meldung + Kontext = eine Zeile) sie nicht
 * zusammenfasst. Level "warning", damit versehentliches Ausfuehren gegen eine
 * echte DB keine Warn-Mail-Semantik suggeriert. Idempotent: erneutes Seeden
 * mit demselben Praefix legt weitere Zeilen an — deshalb Praefix pro Lauf
 * eindeutig waehlen.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }

  const prefix = process.env.SEED_PLATFORM_ERRORS_PREFIX;
  if (!prefix || prefix.trim().length < 8) {
    throw new Error(
      "SEED_PLATFORM_ERRORS_PREFIX muss gesetzt sein (mind. 8 Zeichen, lauf-eindeutig).",
    );
  }
  // LIKE-Sonderzeichen im Praefix wuerden das Cleanup-Muster verfaelschen
  // (z. B. "%" loescht ALLES). Fuer Test-Praefixe schlicht verbieten.
  if (/[%_\\]/.test(prefix)) {
    throw new Error(
      "SEED_PLATFORM_ERRORS_PREFIX darf keine LIKE-Sonderzeichen (%, _, \\) enthalten.",
    );
  }

  const cleanup = process.env.SEED_PLATFORM_ERRORS_CLEANUP === "1";

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (cleanup) {
      const res = await client.query(
        "DELETE FROM platform_errors WHERE message LIKE $1 || '%'",
        [prefix],
      );
      console.log(
        `Cleanup: ${res.rowCount ?? 0} geseedete platform_errors-Zeilen mit Praefix "${prefix}" entfernt.`,
      );
      return;
    }

    const rawCount = process.env.SEED_PLATFORM_ERRORS_COUNT;
    const count = Number(rawCount);
    if (!rawCount || !Number.isInteger(count) || count <= 0 || count > 10_000) {
      throw new Error(
        "SEED_PLATFORM_ERRORS_COUNT muss eine positive Ganzzahl (max. 10000) sein.",
      );
    }

    // Ein einziges INSERT ... SELECT generate_series: schnell genug fuer 500+
    // Zeilen. Eigene Meldung je Zeile (keine Buendelung), Kontext markiert
    // die Herkunft fuer manuelle Inspektion.
    const res = await client.query(
      `INSERT INTO platform_errors (level, message, context)
       SELECT 'warning', $1 || ' #' || g, $3
       FROM generate_series(1, $2::int) AS g`,
      [prefix, count, RETENTION_SEED_CONTEXT],
    );
    console.log(
      `Seed: ${res.rowCount ?? 0} platform_errors-Zeilen mit Praefix "${prefix}" angelegt.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler beim Seeden/Bereinigen von platform_errors:", err);
  process.exit(1);
});
