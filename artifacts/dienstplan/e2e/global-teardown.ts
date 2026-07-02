import { execSync } from "node:child_process";

/**
 * Playwright-globalTeardown: entfernt nach JEDEM E2E-Lauf alle uebrig
 * gebliebenen Test-Konten (`e2e.*@dienstplan.test`) aus der Test-DB.
 *
 * Die Specs raeumen ihre Konten zwar selbst in afterAll auf — bei fehlenden
 * oder fehlgeschlagenen Cleanups faengt dieser Teardown die Reste ab. (Bei
 * hartem Abbruch/Ctrl-C laeuft auch der Teardown nicht; diesen Fall heilt
 * `setup-test-db` vor dem NAECHSTEN Lauf mit demselben Skript.)
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

  try {
    execSync("pnpm --filter @workspace/scripts run cleanup-test-accounts", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch (err) {
    console.error(
      "globalTeardown: Bereinigung der E2E-Test-Konten fehlgeschlagen (Testergebnis bleibt unberuehrt):",
      err,
    );
  }
}
