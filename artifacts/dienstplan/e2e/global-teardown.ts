import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

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
 * Zusaetzlich gibt der Teardown den Lauf-Lock frei, den die Playwright-Config
 * beim Start geschrieben hat (node_modules/.cache/dienstplan-e2e/run.lock) —
 * aber nur, wenn er noch DIESEM Prozess gehoert. Nach hartem Abbruch bleibt
 * der Lock mit toter PID liegen und wird beim naechsten Config-Load als
 * verwaist erkannt (kein manuelles Loeschen noetig).
 *
 * Best effort: Ein Fehlschlag der Bereinigung darf das Testergebnis nicht
 * kippen.
 */

// Repo-Wurzel wie in playwright.config.ts von cwd aus suchen (bewusst
// dupliziert statt aus der Config importiert — ein erneutes Laden der Config
// wuerde deren Start-Seiteneffekte wiederholen).
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function releaseRunLock(): void {
  const runLockPath = path.join(
    findRepoRoot(process.cwd()),
    "node_modules/.cache/dienstplan-e2e/run.lock",
  );
  try {
    if (!existsSync(runLockPath)) return;
    const raw = readFileSync(runLockPath, "utf8").trim();
    if (Number.parseInt(raw, 10) === process.pid) {
      rmSync(runLockPath, { force: true });
      console.log("globalTeardown: Lauf-Lock freigegeben.");
    }
  } catch (err) {
    // Best effort — liegengebliebener Lock heilt sich ueber die tote PID.
    console.warn(
      "globalTeardown: Lauf-Lock konnte nicht freigegeben werden (heilt sich beim naechsten Start):",
      err,
    );
  }
}

export default function globalTeardown(): void {
  releaseRunLock();

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
