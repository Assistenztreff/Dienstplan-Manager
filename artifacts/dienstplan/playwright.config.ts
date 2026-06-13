import { defineConfig, devices } from "@playwright/test";

/**
 * E2E-Konfiguration für die Dienstplan-App.
 *
 * Die App läuft über die Replit-Workflows und ist über den geteilten Proxy
 * unter http://localhost:80 erreichbar (Frontend unter "/", API unter "/api").
 * Der Chromium-Browser wird von der Replit-Umgebung bereitgestellt
 * (REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE).
 *
 * Voraussetzung: Die Workflows "artifacts/api-server" und "artifacts/dienstplan"
 * müssen laufen. Erster Admin-User: admin@dienstplan.local / admin1234
 * (siehe `pnpm --filter @workspace/scripts run setup-admin`).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:80";
const chromiumExecutable = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

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
});
