import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test: die gemerkte Kalender-Ansicht im Dienstplan (Tabelle/Liste vs.
 * Monatsgitter) bleibt nach einem Reload erhalten (localStorage-Key
 * `dienstplan.mobileView`).
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow und Öffnen von /dienstplan
 * - Ansicht im Umschalter wechseln, Seite neu laden → Auswahl bleibt aktiv
 * - Bereinigungsfall: ungültiger gespeicherter Wert → die Ansicht fällt nach
 *   dem Reload sauber auf den Standard ("grid") zurück
 *
 * Läuft im standardmäßig mobilen Viewport (siehe playwright.config.ts); der
 * Ansichts-Umschalter ist dort im Block `dienstplan-mobile` sichtbar.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

const MOBILE_VIEW_KEY = "dienstplan.mobileView";

async function loginAsAdmin(page: Page): Promise<void> {
  // Delegiert an den gemeinsamen Helper, der den Vite-Dev-Auto-Login
  // toleriert (kein Login-Formular) und im Prod-Build das Formular ausfüllt.
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const mobile = page.getByTestId("dienstplan-mobile");
  await expect(mobile).toBeVisible();
  return mobile;
}

test.describe("Dienstplan: gemerkte Kalender-Ansicht (Reload)", () => {
  test.beforeEach(async ({ page }) => {
    // Großzügiges Timeout: der erste Seitenaufruf in einem frischen
    // Browser-Kontext lädt das komplette App-Bundle über den Proxy und kann
    // in der Replit-Umgebung deutlich länger als die Standard-30s dauern.
    test.setTimeout(120_000);
    await loginAsAdmin(page);
  });

  test("behält die gewählte Ansicht (Liste) nach einem Reload bei", async ({ page }) => {
    const mobile = await openCalendar(page);

    // Standard ist das Monatsgitter ("grid").
    await expect(mobile.getByTestId("view-toggle-grid")).toHaveAttribute("data-active", "true");
    await expect(mobile.getByTestId("view-toggle-list")).toHaveAttribute("data-active", "false");

    // Auf die Listenansicht umschalten.
    await mobile.getByTestId("view-toggle-list").click();
    await expect(mobile.getByTestId("view-toggle-list")).toHaveAttribute("data-active", "true");
    await expect(mobile.getByTestId("view-toggle-grid")).toHaveAttribute("data-active", "false");

    // Auswahl muss in localStorage gemerkt worden sein.
    const stored = await page.evaluate((key) => localStorage.getItem(key), MOBILE_VIEW_KEY);
    expect(stored).toBe("list");

    // Seite neu laden: die Auswahl bleibt erhalten.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    const mobileAfter = page.getByTestId("dienstplan-mobile");
    await expect(mobileAfter.getByTestId("view-toggle-list")).toHaveAttribute("data-active", "true");
    await expect(mobileAfter.getByTestId("view-toggle-grid")).toHaveAttribute(
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
      [MOBILE_VIEW_KEY, "voll-unsinn"] as const,
    );

    // Reload: die Persistenzlogik muss den ungültigen Wert ignorieren und auf
    // den Standard ("grid") zurückfallen.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    const mobile = page.getByTestId("dienstplan-mobile");
    await expect(mobile.getByTestId("view-toggle-grid")).toHaveAttribute("data-active", "true");
    await expect(mobile.getByTestId("view-toggle-list")).toHaveAttribute("data-active", "false");

    // Der Standard muss auch in localStorage zurückgeschrieben werden.
    await expect
      .poll(async () => page.evaluate((key) => localStorage.getItem(key), MOBILE_VIEW_KEY))
      .toBe("grid");
  });
});
