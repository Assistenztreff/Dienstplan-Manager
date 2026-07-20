import { test, expect, type Page } from "@playwright/test";

/**
 * E2E-Test: Der Embed-Modus (?embed=1) geht beim clientseitigen Navigieren
 * NICHT verloren.
 *
 * Der Embed-Modus wird nur beim ersten Aufruf ueber die iframe-URL aktiviert
 * und dann in sessionStorage gemerkt (src/lib/embed.ts). Wechselt ein
 * eingebetteter Nutzer per App-Menue die Seite (clientseitige Navigation OHNE
 * Query-Parameter), muessen Plattform-Header und Plattform-Footer weiterhin
 * ausgeblendet bleiben — sonst erscheint ploetzlich die doppelte
 * Plattform-Huelle im iframe.
 *
 * Deckt ab:
 * - Aufruf mit ?embed=1, dann Navigation via App-Menue:
 *   Dashboard → Dienstplan → Einstellungen; nach JEDEM Wechsel sind
 *   platform-header und Plattform-Footer NICHT im DOM.
 * - Gegenprobe: Frischer Kontext OHNE ?embed=1 zeigt Plattform-Header und
 *   -Footer weiterhin (kein versehentliches Dauer-Embed).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

/**
 * Programmatischer Login OHNE anschliessendes goto (die Helper-Variante
 * loginViaUi laedt sofort "/" — hier muss der ERSTE Seitenaufruf aber die
 * ?embed=1-URL sein, damit die Aktivierung ueber die iframe-URL getestet wird).
 */
async function loginViaApi(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Login als ${ADMIN_EMAIL} fehlgeschlagen (${res.status()})`).toBe(true);
}

/** Plattform-Header UND Plattform-Footer duerfen NICHT im DOM sein. */
async function expectNoPlatformChrome(page: Page): Promise<void> {
  await expect(page.getByTestId("platform-header")).toHaveCount(0);
  // Der Plattform-Footer hat kein testid; er ist das einzige footer-Element
  // des Layouts und traegt die Spalten-Ueberschrift "Rechtliches".
  await expect(page.locator("footer")).toHaveCount(0);
  await expect(page.getByText("Rechtliches")).toHaveCount(0);
}

/** Plattform-Header UND Plattform-Footer sind im normalen Modus vorhanden. */
async function expectPlatformChrome(page: Page): Promise<void> {
  await expect(page.getByTestId("platform-header")).toBeVisible();
  await expect(page.locator("footer")).toHaveCount(1);
}

test.describe("Embed-Modus ueberdauert clientseitige Navigation", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    // Erster Seitenaufruf in frischem Kontext laedt das komplette Bundle
    // ueber den Proxy und kann deutlich laenger als 30s dauern.
    test.setTimeout(120_000);
  });

  test("?embed=1 auf dem Dashboard, dann per App-Menue zu Dienstplan und Einstellungen — Plattform-Huelle bleibt weg", async ({
    page,
  }) => {
    await loginViaApi(page);

    // Aktivierung ueber die iframe-URL: Dashboard mit ?embed=1 oeffnen.
    await page.goto("/?embed=1");
    await expect(page.getByTestId("app-subnav-desktop")).toBeVisible();
    await expectNoPlatformChrome(page);

    const subNav = page.getByTestId("app-subnav-desktop");

    // Clientseitige Navigation 1: App-Menue → Dienstplan (KEIN embed-Param
    // mehr in der URL — der Modus muss aus sessionStorage kommen).
    await subNav.getByText("Dienstplan", { exact: true }).click();
    await expect(page).toHaveURL(/\/dienstplan$/);
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
    await expectNoPlatformChrome(page);

    // Clientseitige Navigation 2: App-Menue → Einstellungen.
    await subNav.getByText("Einstellungen", { exact: true }).click();
    await expect(page).toHaveURL(/\/einstellungen$/);
    await expect(page.getByRole("heading", { name: "Einstellungen", exact: true })).toBeVisible();
    await expectNoPlatformChrome(page);

    // Clientseitige Navigation 3: zurueck zum Dashboard (Roundtrip).
    await subNav.getByText("Dashboard", { exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expectNoPlatformChrome(page);
  });

  test("Gegenprobe: frischer Kontext OHNE ?embed=1 zeigt die Plattform-Huelle weiterhin", async ({
    page,
  }) => {
    await loginViaApi(page);

    await page.goto("/");
    await expect(page.getByTestId("app-subnav-desktop")).toBeVisible();
    await expectPlatformChrome(page);

    // Auch nach clientseitiger Navigation bleibt die Huelle im normalen
    // Modus sichtbar (kein versehentliches Dauer-Embed ueber andere Wege).
    await page.getByTestId("app-subnav-desktop").getByText("Einstellungen", { exact: true }).click();
    await expect(page).toHaveURL(/\/einstellungen$/);
    await expectPlatformChrome(page);
  });
});
