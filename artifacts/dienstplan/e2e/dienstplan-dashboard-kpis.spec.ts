import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test für die Dashboard-Kennzahlen-Kacheln.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow und Öffnen des Dashboards ("/")
 * - Jede der vier KPI-Kacheln springt beim Klick auf die richtige Zielseite:
 *   - kpi-active-assistants   -> /assistenten
 *   - kpi-shifts-today        -> /dienstplan?date=<heute> (yyyy-MM-dd)
 *   - kpi-pending-time-entries-> /zeiterfassung?status=pending
 *   - kpi-hours-balance       -> /auswertungen
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

/** Heutiges Datum als yyyy-MM-dd in lokaler Zeit (wie date-fns `format`). */
function todayLocalIso(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function loginAsAdmin(page: Page): Promise<void> {
  // Delegiert an den gemeinsamen Helper, der den Vite-Dev-Auto-Login
  // toleriert (kein Login-Formular) und im Prod-Build das Formular ausfüllt.
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/** Öffnet das Dashboard und wartet, bis die KPI-Kacheln gerendert sind. */
async function openDashboard(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByTestId("kpi-active-assistants")).toBeVisible();
}

test.describe("Dashboard-Kacheln (Admin)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("Kachel 'Aktive Assistenten' springt nach /assistenten", async ({ page }) => {
    await openDashboard(page);
    await page.getByTestId("kpi-active-assistants").click();
    await expect(page).toHaveURL(/\/assistenten$/);
  });

  test("Kachel 'Schichten Heute' springt nach /dienstplan?date=<heute>", async ({ page }) => {
    await openDashboard(page);
    await page.getByTestId("kpi-shifts-today").click();
    await expect(page).toHaveURL(new RegExp(`/dienstplan\\?date=${todayLocalIso()}$`));
  });

  test("Kachel 'Offene Zeiteinträge' springt nach /zeiterfassung?status=pending", async ({ page }) => {
    await openDashboard(page);
    await page.getByTestId("kpi-pending-time-entries").click();
    await expect(page).toHaveURL(/\/zeiterfassung\?status=pending$/);
  });

  test("Kachel 'Stundenbilanz Monat' springt nach /auswertungen", async ({ page }) => {
    await openDashboard(page);
    await page.getByTestId("kpi-hours-balance").click();
    await expect(page).toHaveURL(/\/auswertungen$/);
  });
});
