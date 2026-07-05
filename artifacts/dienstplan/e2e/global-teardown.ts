import { execSync } from "node:child_process";

/**
 * Playwright-globalTeardown: entfernt nach JEDEM E2E-Lauf alle uebrig
 * gebliebenen Test-Reste aus der Test-DB — sowohl Test-Konten
 * (`e2e.*@dienstplan.test`) als auch liegengebliebene Test-Zeilen in
 * `platform_errors` (Dev-Boom + geseedete Retention-Zeilen).
 *
 * Die Specs raeumen ihre Daten zwar selbst in afterAll auf — bei fehlenden
 * oder fehlgeschlagenen Cleanups faengt dieser Teardown die Reste ab. (Bei
 * hartem Abbruch/Ctrl-C laeuft auch der Teardown nicht; diesen Fall heilen
 * dieselben Skripte in `setup-test-db` vor dem NAECHSTEN Lauf.)
 *
 * Best effort: Ein Fehlschlag der Bereinigung darf das Testergebnis nicht
 * kippen.
 */
export default function globalTeardown(): void {
  // Nur fuer den isolierten Test-Stack: dort stellt die Playwright-Config die
  // `_test`-DB-URL als E2E_TEST_DATABASE_URL bereit. Gegen einen externen
  // Stack (E2E_BASE_URL-Override) ist unklar, welche DB dahinterliegt —
  // dann NICHT aufraeumen.
  const testDatabaseUrl = process.env.E2E_TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    console.log(
      "globalTeardown: keine E2E_TEST_DATABASE_URL (externer Stack) — Bereinigung uebersprungen.",
    );
    return;
  }

  const cleanupEnv = { ...process.env, DATABASE_URL: testDatabaseUrl };

  try {
    execSync("pnpm --filter @workspace/scripts run cleanup-test-accounts", {
      env: cleanupEnv,
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch (err) {
    console.error(
      "globalTeardown: Bereinigung der E2E-Test-Konten fehlgeschlagen (Testergebnis bleibt unberuehrt):",
      err,
    );
  }

  try {
    execSync(
      "pnpm --filter @workspace/scripts run cleanup-test-platform-errors",
      {
        env: cleanupEnv,
        stdio: "inherit",
        timeout: 120_000,
      },
    );
  } catch (err) {
    console.error(
      "globalTeardown: Bereinigung der Test-platform_errors-Zeilen fehlgeschlagen (Testergebnis bleibt unberuehrt):",
      err,
    );
  }
}
