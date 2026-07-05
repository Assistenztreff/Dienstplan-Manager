import { defineConfig, devices } from "@playwright/test";
import { spawnSync } from "node:child_process";

/**
 * E2E-Konfiguration für die Dienstplan-App.
 *
 * WICHTIG: Die E2E-Tests legen Daten an und löschen sie wieder (u.a. der
 * Lösch-Test für Assistenzkräfte). Damit das NIE die echte Entwicklungs-
 * Datenbank berührt, startet Playwright hier einen vollständig isolierten
 * Test-Stack gegen eine separate Datenbank:
 *
 *   - eigener API-Server (PORT 8099) mit DATABASE_URL = `<dbname>_test`
 *   - eigener Vite-Server (PORT 5199), der /api an den Test-API weiterleitet
 *
 * Die Test-DB wird direkt hier in der Konfiguration provisioniert (siehe
 * unten: `setup-test-db` läuft synchron beim Laden der Config) — damit gilt
 * das auch für Einzel-Spec-Läufe via `pnpm exec playwright test <name>`,
 * die das `test:e2e`-npm-Skript umgehen. Die laufenden Replit-Workflows und
 * die echte Datenbank bleiben unangetastet.
 *
 * Override-Möglichkeit: Ist `E2E_BASE_URL` von außen gesetzt, wird KEIN
 * Test-Stack gestartet und die Tests laufen gegen die angegebene URL
 * (z.B. den geteilten Proxy unter http://localhost:80) — nur für bewusste
 * manuelle Läufe gedacht.
 */

const API_PORT = process.env.E2E_API_PORT ?? "8099";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5199";

const chromiumExecutable = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

// Externe Override-URL? Dann gegen diese testen, ohne eigenen Stack.
const externalBaseUrl = process.env.E2E_BASE_URL;
const useManagedStack = !externalBaseUrl;

function deriveTestDbUrl(base: string): string {
  const u = new URL(base);
  const current = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  u.pathname = `/${current}_test`;
  return u.toString();
}

const baseURL = externalBaseUrl ?? `http://localhost:${WEB_PORT}`;

// Damit die Specs (eigener `BASE_URL`-Konstantenfallback) denselben Stack
// treffen wie der Browser, E2E_BASE_URL für die Worker-Prozesse setzen.
process.env.E2E_BASE_URL = baseURL;

const databaseUrl = process.env.DATABASE_URL;
if (useManagedStack && !databaseUrl) {
  throw new Error("DATABASE_URL muss für den isolierten E2E-Test-Stack gesetzt sein.");
}
const testDatabaseUrl = databaseUrl ? deriveTestDbUrl(databaseUrl) : "";

// Test-DB VOR jedem Lauf idempotent provisionieren — bewusst hier in der
// Config statt im `test:e2e`-npm-Skript oder in einem globalSetup:
//   - Einzel-Spec-Läufe via `pnpm exec playwright test <name>` umgehen das
//     npm-Skript; ohne dieses Setup liefen sie nach Schema-Änderungen gegen
//     eine veraltete `<dbname>_test`-DB (500 "column ... does not exist").
//   - Die Config lädt garantiert BEVOR die webServer starten — der API-Server
//     bootet also nie gegen eine fehlende/veraltete Test-DB (bei globalSetup
//     ist die Reihenfolge relativ zu webServer nicht garantiert).
// Guards: nur im Hauptprozess (Worker laden die Config erneut, sollen aber
// nicht erneut provisionieren) und nur für den verwalteten Stack —
// `E2E_BASE_URL`-Läufe gegen externe Stacks überspringen das Setup weiterhin.
// `E2E_SKIP_DB_SETUP=1` als bewusste Abkürzung für schnelle Wiederholungs-
// läufe ohne zwischenzeitliche Schema-Änderung.
const isWorkerProcess = !!process.env.TEST_WORKER_INDEX;
if (useManagedStack && !isWorkerProcess && !process.env.E2E_SKIP_DB_SETUP) {
  console.log("[e2e] Test-Datenbank wird provisioniert (setup-test-db)...");
  const setup = spawnSync(
    "pnpm",
    ["--filter", "@workspace/scripts", "run", "setup-test-db"],
    { stdio: "inherit", timeout: 300_000 },
  );
  if (setup.status !== 0 || setup.error != null) {
    throw new Error(
      "setup-test-db fehlgeschlagen — Test-Datenbank konnte nicht provisioniert werden (siehe Ausgabe oben).",
    );
  }

  // Regressionscheck Testkonten-Trennung: beweist VOR jedem E2E-Lauf, dass
  // setup-test-accounts + migrate-teams die Team-Belegung der Dev-Testkonten
  // nicht zerstoeren. Laeuft bewusst HIER (Config-Load, vor dem Start der
  // webServer): der Check seedet/entfernt Konten in der `_test`-DB und darf
  // deshalb nie parallel zu laufenden Specs arbeiten. Er raeumt nach sich
  // selbst restlos auf (Test-DB danach wieder nur Seed-Admin + Standard-Team).
  // Skip via `E2E_SKIP_SEPARATION_CHECK=1` fuer schnelle Wiederholungslaeufe
  // (analog E2E_SKIP_DB_SETUP, das den Check ebenfalls ueberspringt).
  if (!process.env.E2E_SKIP_SEPARATION_CHECK) {
    console.log("[e2e] Testkonten-Trennungs-Check (verify-account-separation)...");
    const separation = spawnSync(
      "pnpm",
      ["--filter", "@workspace/scripts", "run", "verify-account-separation"],
      { stdio: "inherit", timeout: 600_000 },
    );
    if (separation.status !== 0 || separation.error != null) {
      throw new Error(
        "verify-account-separation fehlgeschlagen — die Testkonten-Trennung ist beschaedigt oder der Check konnte nicht laufen (siehe Ausgabe oben). Kein E2E-Lauf gegen einen unklaren Zustand.",
      );
    }
  }

  // Selbstheilungs-Nachweis (verify-test-db-cleanup): beweist VOR jedem E2E-Lauf,
  // dass die `_test`-DB nach einem ABGEBROCHENEN Lauf wieder sauber startet
  // (cleanup-test-accounts entfernt Zombie-Konten restlos, Seed-Admin bleibt).
  // Er dient zusaetzlich als FK-Waechter und erkennt neue team-gebundene
  // Tabellen ohne Cleanup-Zweig.
  // Laeuft bewusst HIER (Config-Load, vor dem webServer-Start):
  // er seedet/entfernt Konten in der `_test`-DB und darf nie parallel zu Specs
  // laufen. Skip via `E2E_SKIP_CLEANUP_CHECK=1` fuer schnelle Wiederholungslaeufe
  // (analog E2E_SKIP_SEPARATION_CHECK).
  if (!process.env.E2E_SKIP_CLEANUP_CHECK) {
    console.log("[e2e] Selbstheilungs-Check (verify-test-db-cleanup)...");
    const cleanup = spawnSync(
      "pnpm",
      ["--filter", "@workspace/scripts", "run", "verify-test-db-cleanup"],
      { stdio: "inherit", timeout: 600_000 },
    );
    if (cleanup.status !== 0 || cleanup.error != null) {
      throw new Error(
        "verify-test-db-cleanup fehlgeschlagen — die Test-DB-Selbstheilung ist beschaedigt oder der Check konnte nicht laufen (siehe Ausgabe oben). Kein E2E-Lauf gegen einen unklaren Zustand.",
      );
    }
  }
}

// Damit Specs/Helper, die zur Laufzeit einen zweiten Admin seeden
// (`seedForeignAdmin` -> setup-admin per execSync), in DIESELBE Datenbank
// schreiben, gegen die der isolierte Test-API-Server läuft (die `_test`-DB),
// die abgeleitete Test-DB-URL für die Worker-Prozesse bereitstellen. Ohne das
// erbt der execSync die Dev-`DATABASE_URL` und der Admin landet in der Dev-DB
// -> der spätere Login gegen die Test-DB schlägt fehl.
if (useManagedStack && testDatabaseUrl) {
  process.env.E2E_TEST_DATABASE_URL = testDatabaseUrl;
}

export default defineConfig({
  testDir: "./e2e",
  // Nach jedem Lauf uebrig gebliebene `e2e.*@dienstplan.test`-Konten aus der
  // Test-DB entfernen (Specs, deren afterAll-Cleanup fehlte/fehlschlug).
  // Harte Abbrueche heilt zusaetzlich setup-test-db VOR dem naechsten Lauf.
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // Unter Volllast der Gesamtsuite (ein Worker, geteilter Test-Stack) reichen
  // die 30s-Defaults fuer mehrstufige UI-Flows nicht zuverlaessig — einzelne
  // Specs kippen sonst lauf-abhaengig (Whack-a-mole). Echte Haenger werden
  // weiterhin erkannt, nur eben nach 60s.
  timeout: 60000,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    // Mobiles Viewport: die Liste/Monat-Umschaltung ist nur in der
    // Mobilansicht (md:hidden) sichtbar.
    viewport: { width: 400, height: 720 },
    launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : {},
  },
  ...(useManagedStack
    ? {
        webServer: [
          {
            // Isolierter API-Server auf der Test-Datenbank.
            command: "pnpm --filter @workspace/api-server run dev",
            url: `http://localhost:${API_PORT}/api/healthz`,
            timeout: 120000,
            reuseExistingServer: false,
            env: {
              PORT: API_PORT,
              DATABASE_URL: testDatabaseUrl,
              NODE_ENV: "development",
            },
          },
          {
            // Isolierter Vite-Server, leitet /api an den Test-API weiter.
            command: "pnpm --filter @workspace/dienstplan run dev",
            url: `http://localhost:${WEB_PORT}/`,
            timeout: 120000,
            reuseExistingServer: false,
            env: {
              PORT: WEB_PORT,
              BASE_PATH: "/",
              E2E_API_PROXY_TARGET: `http://localhost:${API_PORT}`,
            },
          },
        ],
      }
    : {}),
});
