/**
 * MonthYearPicker – Klick auf das Monatslabel öffnet ein Popover-Raster,
 * das einen Monatssprung per Kachel ermöglicht.
 */
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

test.use({ viewport: { width: 1280, height: 800 } });

async function loginViaApi(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Login fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
}

test.describe("MonthYearPicker – Dienstplan", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page);
    await page.goto("/dienstplan");
    await page.waitForSelector('[data-testid="month-label"]');
  });

  test("Klick auf Monatslabel öffnet Popover mit Jahres-Navigation und 12 Monatskacheln", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Popover ist zunächst nicht sichtbar.
    await expect(
      page.locator('[data-testid="month-year-picker-popover"]'),
    ).not.toBeVisible();

    // Klick auf den Trigger öffnet das Popover.
    await page.locator('[data-testid="month-label"]').click();

    const popover = page.locator('[data-testid="month-year-picker-popover"]');
    await expect(popover).toBeVisible();

    // Jahresanzeige vorhanden.
    await expect(popover.locator('[data-testid="picker-year"]')).toBeVisible();

    // 12 Monatskacheln sind im Raster.
    const tiles = popover.locator("button[data-month]");
    await expect(tiles).toHaveCount(12);
  });

  test("Jahreswechsel-Pfeile ändern die angezeigte Jahreszahl", async ({ page }) => {
    test.setTimeout(60_000);

    await page.locator('[data-testid="month-label"]').click();
    const popover = page.locator('[data-testid="month-year-picker-popover"]');
    await expect(popover).toBeVisible();

    const yearLabel = popover.locator('[data-testid="picker-year"]');
    const yearText = await yearLabel.textContent();
    const currentYear = parseInt(yearText?.trim() ?? "0", 10);

    // Ein Jahr zurück.
    await popover.locator('[data-testid="picker-prev-year"]').click();
    await expect(yearLabel).toHaveText(String(currentYear - 1));

    // Zwei Jahre vor.
    await popover.locator('[data-testid="picker-next-year"]').click();
    await popover.locator('[data-testid="picker-next-year"]').click();
    await expect(yearLabel).toHaveText(String(currentYear + 1));
  });

  test("Monatssprung +6 Monate per Kachel zeigt den richtigen Monat und schließt das Popover", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const trigger = page.locator('[data-testid="month-label"]');
    await trigger.click();
    const popover = page.locator('[data-testid="month-year-picker-popover"]');
    await expect(popover).toBeVisible();

    // Aktuelles Jahr aus dem Picker lesen.
    const yearText = await popover
      .locator('[data-testid="picker-year"]')
      .textContent();
    const baseYear = parseInt(yearText?.trim() ?? "0", 10);

    // Aktuell gewählte Kachel (aria-pressed=true).
    const selectedTile = popover.locator('button[data-month][aria-pressed="true"]');
    const selectedMonthStr = await selectedTile.getAttribute("data-month");
    const baseMonth = parseInt(selectedMonthStr ?? "1", 10);

    // Zielmonat: +6 (mit Jahreswechsel wenn nötig).
    let targetMonth = baseMonth + 6;
    let targetYear = baseYear;
    if (targetMonth > 12) {
      targetMonth -= 12;
      targetYear += 1;
      await popover.locator('[data-testid="picker-next-year"]').click();
    }

    // Monatskachel anklicken.
    await popover.locator(`button[data-month="${targetMonth}"]`).click();

    // Popover schließt sich.
    await expect(popover).not.toBeVisible();

    // Trigger-Label (aria-label) enthält die neue Jahreszahl.
    const ariaLabel = await trigger.getAttribute("aria-label");
    expect(ariaLabel).toContain(String(targetYear));
  });

  test("Escape schließt das Popover ohne Monatswechsel", async ({ page }) => {
    test.setTimeout(60_000);

    const trigger = page.locator('[data-testid="month-label"]');
    const labelBefore = await trigger.getAttribute("aria-label");

    await trigger.click();
    const popover = page.locator('[data-testid="month-year-picker-popover"]');
    await expect(popover).toBeVisible();

    // Ins nächste Jahr navigieren, OHNE eine Kachel zu klicken.
    await popover.locator('[data-testid="picker-next-year"]').click();

    // Escape schließt ohne Übernahme.
    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible();

    // Label unverändert.
    const labelAfter = await trigger.getAttribute("aria-label");
    expect(labelAfter).toBe(labelBefore);
  });
});
