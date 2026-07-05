import pg from "pg";

/**
 * Entfernt ALLE liegengebliebenen Test-Zeilen aus `platform_errors` in EINEM
 * Batch aus der isolierten Test-Datenbank.
 *
 * Hintergrund: Mehrere E2E-Specs erzeugen absichtlich `platform_errors`-Zeilen
 * (Karte „Fehler-Tracking" im Operator-Dashboard):
 *   - der Dev-Boom (`GET /api/dev/boom`) loest unbehandelte Serverfehler aus,
 *     die vom zentralen Error-Handler unter Kontext `GET /api/dev/boom`
 *     persistiert werden (auch die gelabelten `?label=`-Varianten teilen sich
 *     diesen Kontext),
 *   - `seed-platform-errors` seedet kuenstliche Retention-Zeilen unter Kontext
 *     `e2e/retention-seed`.
 * Die Specs raeumen ihre Zeilen zwar selbst in afterAll auf — bricht ein Lauf
 * aber mittendrin ab (Timeout, Ctrl-C, Crash), laufen die afterAll-Hooks nicht
 * und die Zeilen bleiben als Leichen in der `_test`-DB liegen und koennen die
 * naechsten Laeufe stoeren (z. B. die Retention-Vorbedingung „Tabelle unter
 * dem Aufbewahrungslimit"). Dieses Skript macht die Test-DB selbstheilend;
 * es wird — analog `cleanup-test-accounts` — aufgerufen:
 *   - von `setup-test-db.ts` VOR jedem Lauf (heilt Reste abgebrochener Laeufe),
 *   - vom Playwright-globalTeardown NACH jedem Lauf.
 *
 * Sicherung gegen versehentliches Loeschen echter Daten:
 *   1. Es werden AUSSCHLIESSLICH Zeilen mit den beiden Test-Kontexten oben
 *      geloescht — echte Plattform-Fehler tragen ihre jeweilige Route/Stelle
 *      als Kontext und sind nie betroffen.
 *   2. Zusaetzlich wird die Ziel-Datenbank auf das `_test`-Namensschema
 *      geprueft (`deriveTestDbUrl`); zeigt DATABASE_URL nicht auf die
 *      abgeleitete Test-DB, bricht das Skript ohne Loeschung ab.
 *
 * Idempotent: keine Treffer = Erfolg (Exit 0).
 */

// Test-Kontexte, unter denen E2E-/Seed-Zeilen in platform_errors landen.
// Muessen synchron bleiben mit:
//   - artifacts/api-server/src/routes/health.ts (Dev-Boom-Route)
//   - scripts/src/seed-platform-errors.ts (Retention-Seed)
const TEST_ERROR_CONTEXTS = ["GET /api/dev/boom", "e2e/retention-seed"] as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }

  // Sicherheitsnetz: NUR gegen eine `_test`-Datenbank arbeiten (Namensschema
  // aus `deriveTestDbUrl`). So kann ein versehentlicher Aufruf mit der
  // Dev-`DATABASE_URL` keine echten Daten loeschen (Constraint: Dev-DB
  // unberuehrt lassen). Aufgerufen wird das Skript IMMER mit der bereits
  // abgeleiteten Test-DB-URL (`<dbname>_test`).
  const currentDbName = decodeURIComponent(
    new URL(databaseUrl).pathname.replace(/^\//, ""),
  );
  if (!currentDbName.endsWith("_test")) {
    throw new Error(
      `Sicherheitsabbruch: DATABASE_URL zeigt auf "${currentDbName}", keine Test-Datenbank (erwartet Suffix "_test"). ` +
        "Dieses Skript loescht ausschliesslich in der isolierten Test-Datenbank.",
    );
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const res = await client.query(
      "DELETE FROM platform_errors WHERE context = ANY($1::text[])",
      [TEST_ERROR_CONTEXTS],
    );
    const deleted = res.rowCount ?? 0;
    if (deleted === 0) {
      console.log("Keine liegengebliebenen Test-platform_errors-Zeilen — nichts zu tun.");
    } else {
      console.log(
        `Liegengebliebene Test-platform_errors-Zeilen bereinigt: ${deleted} Zeile(n).`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fehler beim Bereinigen der Test-platform_errors-Zeilen:", err);
  process.exit(1);
});
