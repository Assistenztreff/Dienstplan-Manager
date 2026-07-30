import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * Task #673 — Schnellen Monatssprung auch auf der Abwesenheiten-Seite.
 *
 * Die Abwesenheiten-Seite hat Prev/Next-Pfeile für den Monatswechsel.
 * Zusätzlich öffnet ein Klick auf das Monatslabel den MonthYearPicker
 * (dieselbe Komponente wie auf Dienstplan/Auswertungen).
 *
 *   1. Klick auf Monatslabel öffnet das Raster-Popover.
 *   2. Jahres-Navigation per picker-prev-year / picker-next-year.
 *   3. Klick auf Monatskachel schließt Popover und aktualisiert Label.
 *   4. Prev-Pfeil (absence-prev-month) navigiert einen Monat zurück.
 *   5. Next-Pfeil (absence-next-month) navigiert wieder vor.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

test.use({ viewport: { width: 1280, height: 800 } });

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function parseMonthLabel(text: string): { year: number; monthIndex: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]!);
  const year = Number(parts[1]);
  return { year, monthIndex };
}

let adminCtx: APIRequestContext;

test.beforeAll(async () => {
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);
});

test.afterAll(async () => {
  await adminCtx.dispose();
});

test("Klick auf Monatslabel öffnet MonthYearPicker, Monatswahl aktualisiert Label (#673)", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/abwesenheiten");

  const label = page.getByTestId("absence-month-label");
  await expect(label).toBeVisible({ timeout: 20_000 });

  // Picker ist initial geschlossen
  await expect(page.getByTestId("month-year-picker-popover")).not.toBeVisible();

  // Klick auf Label öffnet Raster
  await label.click();
  const popover = page.getByTestId("month-year-picker-popover");
  await expect(popover).toBeVisible({ timeout: 5_000 });

  // Jahresanzeige lesbar
  const yearText = await page.getByTestId("picker-year").textContent();
  expect(Number(yearText?.trim())).toBeGreaterThan(2020);

  // Jahres-Navigation zurück
  await page.getByTestId("picker-prev-year").click();
  const yearAfterPrev = await page.getByTestId("picker-year").textContent();
  expect(Number(yearAfterPrev?.trim())).toBe(Number(yearText?.trim()) - 1);

  // Jahres-Navigation vor
  await page.getByTestId("picker-next-year").click();

  // Monat März wählen (data-month=3)
  await page.locator('[data-testid="month-year-picker-popover"] [data-month="3"]').click();

  // Popover schließt sich
  await expect(popover).not.toBeVisible({ timeout: 5_000 });

  // Label zeigt jetzt März + aktuelles Jahr
  const labelText = (await label.textContent()) ?? "";
  expect(labelText).toContain("März");
  expect(labelText).toContain(String(Number(yearText?.trim())));
});

test("Prev/Next-Pfeile navigieren weiterhin monatsweise (#673)", async ({ page }) => {
  test.setTimeout(45_000);
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/abwesenheiten");

  const label = page.getByTestId("absence-month-label");
  await expect(label).toBeVisible({ timeout: 20_000 });

  const labelBefore = (await label.textContent()) ?? "";
  const { year: yearBefore, monthIndex: miBefore } = parseMonthLabel(labelBefore);

  // Einen Monat zurück
  await page.getByTestId("absence-prev-month").click();
  const prevDate = new Date(yearBefore, miBefore - 1, 1);
  await expect(label).toContainText(MONTHS_DE[prevDate.getMonth()]!, { timeout: 5_000 });

  // Wieder einen Monat vor
  await page.getByTestId("absence-next-month").click();
  await expect(label).toContainText(MONTHS_DE[miBefore]!, { timeout: 5_000 });
  const labelAfter = (await label.textContent()) ?? "";
  expect(labelAfter.trim()).toBe(labelBefore.trim());
});
