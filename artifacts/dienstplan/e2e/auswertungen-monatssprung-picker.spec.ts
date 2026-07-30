import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * Task #672 — Schnellen Monatssprung per Picker auch auf der Auswertungen-Seite.
 *
 * Die Auswertungen-Seite teilt denselben PageStickyHeader wie der Dienstplan.
 * Dieser Spec schreibt die drei Navigationswege fest:
 *
 *   1. Pfeil "Vormonat" (month-prev) navigiert einen Monat zurück.
 *   2. Pfeil "Nächsten Monat" (month-next) navigiert wieder vor.
 *   3. Klick auf das Monats-Label öffnet das Monats-Raster-Popover
 *      (month-year-picker-popover), Jahres-Navigation per picker-prev-year und
 *      picker-next-year funktioniert.
 *
 * Desktop-Viewport: Sticky-Header ist vollständig sichtbar.
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

test("Vormonat-Pfeil navigiert einen Monat zurück (#672)", async ({ page }) => {
  test.setTimeout(45_000);
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/auswertungen");
  await expect(page.getByTestId("month-label")).toBeVisible({ timeout: 20_000 });

  const labelBefore = (await page.getByTestId("month-label").textContent()) ?? "";
  const { year: yearBefore, monthIndex: miBefore } = parseMonthLabel(labelBefore);

  await page.getByTestId("month-prev").click();

  // Erwarteter Vormonat
  const prevDate = new Date(yearBefore, miBefore - 1, 1);
  const expectedLabel = `${MONTHS_DE[prevDate.getMonth()]} ${prevDate.getFullYear()}`;

  await expect(page.getByTestId("month-label")).toContainText(
    MONTHS_DE[prevDate.getMonth()]!,
    { timeout: 10_000 },
  );
  const labelAfter = (await page.getByTestId("month-label").textContent()) ?? "";
  expect(labelAfter.trim()).toBe(expectedLabel);
});

test("Nächsten-Monat-Pfeil navigiert einen Monat vor (#672)", async ({ page }) => {
  test.setTimeout(45_000);
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/auswertungen");
  await expect(page.getByTestId("month-label")).toBeVisible({ timeout: 20_000 });

  // Erst zurück, dann wieder vor — so hat month-next einen nachweisbaren Effekt.
  await page.getByTestId("month-prev").click();
  await expect(page.getByTestId("month-label")).toBeVisible();
  const labelBack = (await page.getByTestId("month-label").textContent()) ?? "";
  const { year: yBack, monthIndex: miBack } = parseMonthLabel(labelBack);

  await page.getByTestId("month-next").click();

  const fwdDate = new Date(yBack, miBack + 1, 1);
  const expectedLabel = `${MONTHS_DE[fwdDate.getMonth()]} ${fwdDate.getFullYear()}`;

  await expect(page.getByTestId("month-label")).toContainText(
    MONTHS_DE[fwdDate.getMonth()]!,
    { timeout: 10_000 },
  );
  const labelFwd = (await page.getByTestId("month-label").textContent()) ?? "";
  expect(labelFwd.trim()).toBe(expectedLabel);
});

test("Klick auf Monats-Label öffnet Raster-Popover, Jahres-Navigation funktioniert (#672)", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/auswertungen");
  await expect(page.getByTestId("month-label")).toBeVisible({ timeout: 20_000 });

  // Popover ist initial geschlossen
  await expect(page.getByTestId("month-year-picker-popover")).not.toBeVisible();

  // Klick auf Label öffnet das Raster
  await page.getByTestId("month-label").click();
  await expect(page.getByTestId("month-year-picker-popover")).toBeVisible({
    timeout: 5_000,
  });

  // Jahresanzeige lesbar
  const yearText = await page.getByTestId("picker-year").textContent();
  expect(Number(yearText?.trim())).toBeGreaterThan(2020);

  // Jahres-Navigation zurück
  await page.getByTestId("picker-prev-year").click();
  const yearAfterPrev = await page.getByTestId("picker-year").textContent();
  expect(Number(yearAfterPrev?.trim())).toBe(Number(yearText?.trim()) - 1);

  // Jahres-Navigation vor
  await page.getByTestId("picker-next-year").click();
  const yearAfterNext = await page.getByTestId("picker-year").textContent();
  expect(Number(yearAfterNext?.trim())).toBe(Number(yearText?.trim()));

  // Escape schließt das Popover
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("month-year-picker-popover")).not.toBeVisible({
    timeout: 3_000,
  });
});
