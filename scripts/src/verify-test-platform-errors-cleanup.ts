import { execSync } from "node:child_process";
import pg from "pg";
import { deriveTestDbUrl } from "./lib/test-db-url.js";
import { TEST_ERROR_CONTEXTS } from "@workspace/test-fixtures";

/**
 * Beweist automatisiert, dass der Fehlerzeilen-Cleanup
 * (`cleanup-test-platform-errors`) wirklich greift UND echte Fehler verschont —
 * analog zum Selbstheilungs-Nachweis fuer Konten (`verify-test-db-cleanup`).
 *
 * Hintergrund: Der Fehlerzeilen-Cleanup entfernt liegengebliebene
 * `platform_errors`-Zeilen abgebrochener E2E-Laeufe (Dev-Boom + Retention-Seed).
 * Ohne automatisierten Beweis kann er still verrutschen (z. B. wenn sich ein
 * Test-Kontext oder die WHERE-Bedingung aendert) und die Test-DB laeuft wieder
 * mit Alt-Daten voll — genau das Problem, das der Cleanup beheben sollte.
 *
 * Ablauf:
 *   1. Reste eines frueheren Check-Laufs entsorgen (idempotent, ueber den
 *      eindeutigen Check-Marker).
 *   2. Seeden: je eine Zeile fuer JEDEN Test-Kontext (`TEST_ERROR_CONTEXTS`)
 *      PLUS eine "echte" Fehlerzeile mit einem fremden Kontext (kein
 *      Test-Kontext) — genau der Zustand, den ein abgebrochener Lauf neben
 *      echten Plattform-Fehlern hinterlaesst.
 *   3. `cleanup-test-platform-errors` gegen die `_test`-DB laufen lassen (wie in
 *      `setup-test-db` vor jedem Lauf bzw. im Playwright-globalTeardown).
 *   4. Assertions: beide Test-Kontext-Zeilen weg, die echte Zeile bleibt.
 *   5. Idempotenz: zweiter Cleanup-Lauf laeuft sauber durch, die echte Zeile
 *      bleibt weiterhin unberuehrt.
 *   6. Aufraeumen: die geseedete echte Zeile am Ende selbst entfernen (der
 *      Cleanup laesst sie bewusst stehen).
 *
 * Alle Zeilen dieses Checks tragen einen eindeutigen Marker im Meldungstext
 * (`CHECK_MARKER`), damit ausschliesslich eigene Seeds inspiziert/aufgeraeumt
 * werden — echte `platform_errors` bleiben unangetastet.
 *
 * Laeuft AUSSCHLIESSLICH gegen die `_test`-DB (abgeleitet aus DATABASE_URL),
 * die Dev-DB wird nie beruehrt. Fehlt die `_test`-DB, wird sie automatisch
 * ueber `setup-test-db` provisioniert. Exit 0 = bewiesen korrekt, Exit 1 =
 * Regression (Fehlermeldung nennt die Ursache).
 */

// Eindeutiger Marker fuer alle von diesem Check geseedeten Zeilen. So werden
// niemals fremde (echte) platform_errors-Zeilen mitgezaehlt oder geloescht.
const CHECK_MARKER = "e2e-cleanup-proof/platform-errors-verify";
// Kontext der "echten" Fehlerzeile: BEWUSST KEIN Test-Kontext — sie muss den
// Cleanup ueberleben. Traegt zusaetzlich den CHECK_MARKER, damit dieser Check
// sie am Ende selbst entfernt (der Cleanup laesst sie stehen).
const REAL_ERROR_CONTEXT = "verify/real-platform-error-must-survive";

class CheckError extends Error {}

async function main(): Promise<void> {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL muss gesetzt sein.");
  }
  const { url: testUrl, name: testDbName } = deriveTestDbUrl(base);

  // _test-DB bei Bedarf provisionieren (idempotent).
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    testDbName,
  ]);
  await admin.end();
  if (exists.rowCount === 0) {
    console.log(`Test-DB "${testDbName}" fehlt — provisioniere via setup-test-db …`);
    execSync("pnpm --filter @workspace/scripts run setup-test-db", {
      stdio: "inherit",
      timeout: 300_000,
    });
  }

  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();

  const runCleanup = (): void => {
    execSync("pnpm --filter @workspace/scripts run cleanup-test-platform-errors", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: testUrl },
      timeout: 120_000,
    });
  };

  // Zaehlt eigene Seed-Zeilen (ueber den Marker) mit einem bestimmten Kontext.
  const countOwn = async (context: string): Promise<number> => {
    const res = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_errors WHERE context = $1 AND message LIKE $2 || '%'",
      [context, CHECK_MARKER],
    );
    return res.rows[0].n;
  };

  try {
    // ------------------------------------------------------------------
    // 1) Reste eines frueheren Check-Laufs entsorgen (idempotent).
    // ------------------------------------------------------------------
    await client.query("DELETE FROM platform_errors WHERE message LIKE $1 || '%'", [
      CHECK_MARKER,
    ]);

    // ------------------------------------------------------------------
    // 2) Seeden: je eine Test-Kontext-Zeile + eine echte Fehlerzeile.
    // ------------------------------------------------------------------
    for (const context of TEST_ERROR_CONTEXTS) {
      await client.query(
        "INSERT INTO platform_errors (level, message, context) VALUES ('warning', $1, $2)",
        [`${CHECK_MARKER} ${context}`, context],
      );
    }
    await client.query(
      "INSERT INTO platform_errors (level, message, context) VALUES ('error', $1, $2)",
      [`${CHECK_MARKER} echter Fehler`, REAL_ERROR_CONTEXT],
    );
    console.log(
      `Geseedet: je 1 Zeile fuer ${TEST_ERROR_CONTEXTS.join(", ")} + 1 echte Zeile ` +
        `(Kontext "${REAL_ERROR_CONTEXT}").`,
    );

    // Vorbedingung bestaetigen, damit ein spaeterer "alles weg" nicht faelsch
    // als Erfolg durchgeht, obwohl gar nichts geseedet wurde.
    for (const context of TEST_ERROR_CONTEXTS) {
      if ((await countOwn(context)) !== 1) {
        throw new CheckError(
          `Vorbedingung verletzt: Test-Kontext-Zeile "${context}" wurde nicht angelegt.`,
        );
      }
    }
    if ((await countOwn(REAL_ERROR_CONTEXT)) !== 1) {
      throw new CheckError(
        "Vorbedingung verletzt: echte Fehlerzeile wurde nicht angelegt.",
      );
    }

    // ------------------------------------------------------------------
    // 3) Cleanup ausfuehren (wie setup-test-db / globalTeardown).
    // ------------------------------------------------------------------
    runCleanup();

    // ------------------------------------------------------------------
    // 4) Assertions: Test-Kontexte weg, echte Zeile bleibt.
    // ------------------------------------------------------------------
    const failures: string[] = [];
    for (const context of TEST_ERROR_CONTEXTS) {
      const left = await countOwn(context);
      if (left > 0) {
        failures.push(
          `Test-Kontext "${context}" hat den Cleanup ueberlebt (${left} Zeile(n) uebrig).`,
        );
      }
    }
    const realLeft = await countOwn(REAL_ERROR_CONTEXT);
    if (realLeft !== 1) {
      failures.push(
        `Echte Fehlerzeile (Kontext "${REAL_ERROR_CONTEXT}") wurde faelschlich geloescht ` +
          `(erwartet 1, gefunden ${realLeft}) — der Cleanup greift zu breit.`,
      );
    }

    // ------------------------------------------------------------------
    // 5) Idempotenz: zweiter Lauf laeuft durch, echte Zeile bleibt.
    // ------------------------------------------------------------------
    runCleanup();
    const realAfterSecond = await countOwn(REAL_ERROR_CONTEXT);
    if (realAfterSecond !== 1) {
      failures.push(
        `Nach dem zweiten (idempotenten) Cleanup-Lauf ist die echte Fehlerzeile nicht mehr ` +
          `unversehrt (erwartet 1, gefunden ${realAfterSecond}).`,
      );
    }

    if (failures.length > 0) {
      throw new CheckError(
        `Fehlerzeilen-Cleanup-Check FEHLGESCHLAGEN:\n  - ${failures.join("\n  - ")}`,
      );
    }

    console.log(
      "Fehlerzeilen-Cleanup-Check OK: beide Test-Kontexte entfernt, echte Fehlerzeile " +
        "unangetastet, zweiter Lauf idempotent — der Cleanup greift und verschont echte Fehler.",
    );
  } finally {
    // Aufraeumen: die geseedete echte Zeile (und etwaige Reste) selbst
    // entfernen — der Cleanup laesst sie bewusst stehen.
    await client.query("DELETE FROM platform_errors WHERE message LIKE $1 || '%'", [
      CHECK_MARKER,
    ]);
    await client.end();
  }
}

main().catch((err) => {
  if (err instanceof CheckError) {
    console.error(`\n${err.message}`);
  } else {
    console.error("Fehler beim Fehlerzeilen-Cleanup-Check:", err);
  }
  process.exit(1);
});
