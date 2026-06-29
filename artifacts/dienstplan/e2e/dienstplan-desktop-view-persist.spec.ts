import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * E2E-Test: die gemerkte Kalender-Ansicht am PC (Tabelle vs. Monatsgitter)
 * bleibt nach einem Reload erhalten (localStorage-Key
 * `dienstplan.desktopView`).
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow und Öffnen von /dienstplan
 * - Im Desktop-Block (`dienstplan-desktop`) von "Tabelle" auf "Monat" wechseln,
 *   Seite neu laden → Auswahl bleibt aktiv
 * - Bereinigungsfall: ungültiger gespeicherter Wert → die Ansicht fällt nach
 *   dem Reload sauber auf den Standard ("table") zurück
 *
 * Anders als die übrigen Specs läuft dieser Test in einem Desktop-Viewport
 * (siehe test.use unten), da der Umschalter Tabelle/Monat nur in der
 * Desktop-Ansicht (`md:block`) sichtbar ist. Die Standardkonfiguration nutzt
 * ein mobiles Viewport.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

const DESKTOP_VIEW_KEY = "dienstplan.desktopView";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  // Nach erfolgreichem Login navigiert die App zur Startseite ("/").
  await expect(page).toHaveURL(/\/$/);
}

async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop).toBeVisible();
  return desktop;
}

test.describe("Dienstplan: gemerkte Kalender-Ansicht am PC (Reload)", () => {
  // Desktop-Viewport: der Umschalter Tabelle/Monat ist nur ab `md` sichtbar.
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    // Großzügiges Timeout: der erste Seitenaufruf in einem frischen
    // Browser-Kontext lädt das komplette App-Bundle über den Proxy und kann
    // in der Replit-Umgebung deutlich länger als die Standard-30s dauern.
    test.setTimeout(120_000);
    await loginAsAdmin(page);
  });

  test("behält die gewählte Ansicht (Monat) nach einem Reload bei", async ({ page }) => {
    const desktop = await openCalendar(page);

    // Standard am PC ist die Tabellenansicht ("table").
    await expect(desktop.getByTestId("view-toggle-table")).toHaveAttribute("data-active", "true");
    await expect(desktop.getByTestId("view-toggle-grid")).toHaveAttribute("data-active", "false");

    // Auf die Monatsansicht umschalten.
    await desktop.getByTestId("view-toggle-grid").click();
    await expect(desktop.getByTestId("view-toggle-grid")).toHaveAttribute("data-active", "true");
    await expect(desktop.getByTestId("view-toggle-table")).toHaveAttribute("data-active", "false");

    // Auswahl muss in localStorage gemerkt worden sein.
    const stored = await page.evaluate((key) => localStorage.getItem(key), DESKTOP_VIEW_KEY);
    expect(stored).toBe("grid");

    // Seite neu laden: die Auswahl bleibt erhalten.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    const desktopAfter = page.getByTestId("dienstplan-desktop");
    await expect(desktopAfter.getByTestId("view-toggle-grid")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(desktopAfter.getByTestId("view-toggle-table")).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  test("fällt auf die Standardansicht zurück, wenn ein ungültiger Wert gespeichert ist", async ({
    page,
  }) => {
    // Zuerst die Seite öffnen, damit localStorage für diese Origin verfügbar ist.
    await openCalendar(page);

    // Einen ungültigen Ansichtswert merken, den die App nicht kennt.
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [DESKTOP_VIEW_KEY, "voll-unsinn"] as const,
    );

    // Reload: die Persistenzlogik muss den ungültigen Wert ignorieren und auf
    // den Standard ("table") zurückfallen.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId("view-toggle-table")).toHaveAttribute("data-active", "true");
    await expect(desktop.getByTestId("view-toggle-grid")).toHaveAttribute("data-active", "false");

    // Der Standard muss auch in localStorage zurückgeschrieben werden.
    await expect
      .poll(async () => page.evaluate((key) => localStorage.getItem(key), DESKTOP_VIEW_KEY))
      .toBe("table");
  });
});
