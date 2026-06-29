import { defineConfig, devices } from "@playwright/test";

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
 * Die Test-DB wird vor dem Lauf provisioniert (siehe `test:e2e`-Script:
 * `pnpm --filter @workspace/scripts run setup-test-db`). Die laufenden
 * Replit-Workflows und die echte Datenbank bleiben unangetastet.
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
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
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
