import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { registerFreeAccount, deleteFreeAccount, type FreeAccount } from "./helpers/teams";

/**
 * Tastatur-Navigation im Monatskalender (MonthGrid, WAI-ARIA-Grid-Pattern):
 *
 * - Roving Tabindex: genau EINE Tageszelle traegt tabindex=0, alle anderen -1.
 * - Pfeiltasten bewegen den Fokus zwischen Tageszellen (links/rechts = +-1 Tag,
 *   hoch/runter = +-7 Tage), Home/End springen zum Wochenanfang/-ende.
 * - Enter loest das Zwei-Stufen-Verhalten aus: 1. Enter markiert den Tag
 *   (aria-selected), 2. Enter auf dem markierten Tag oeffnet den Schicht-Dialog.
 */

const PASSWORD = "free12345"; // registerFreeAccount vergibt dieses Passwort.
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

let acc: FreeAccount;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "monatstastatur");
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Monatskalender: Pfeiltasten/Home/End bewegen den Fokus, Enter waehlt und oeffnet", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
  const page = await context.newPage();
  try {
    await loginViaUi(page, acc.email, PASSWORD);
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    // Desktop-Rasteransicht aktivieren (Standard kann die Tabelle sein).
    await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid").click();
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId("month-grid")).toBeVisible();

    const cells = desktop.locator('[data-testid^="day-cell-"]');
    const cellCount = await cells.count();
    expect(cellCount, "Der Monat muss Tageszellen haben").toBeGreaterThanOrEqual(28);

    // Roving Tabindex: genau EINE Zelle in der Tab-Reihenfolge.
    await expect(
      desktop.locator('[data-testid^="day-cell-"][tabindex="0"]'),
      "Genau eine Tageszelle darf tabindex=0 tragen",
    ).toHaveCount(1);

    const activeTestId = () =>
      page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
    const dayOf = (testId: string) => Number(testId.slice(-2));

    // Auf einer Zelle in der Monatsmitte starten (Rand-Clamping vermeiden).
    const startCell = cells.nth(14);
    const startId = (await startCell.getAttribute("data-testid"))!;
    await startCell.focus();

    await page.keyboard.press("ArrowRight");
    expect(dayOf(await activeTestId()), "Pfeil rechts = +1 Tag").toBe(dayOf(startId) + 1);

    await page.keyboard.press("ArrowDown");
    expect(dayOf(await activeTestId()), "Pfeil runter = +7 Tage").toBe(dayOf(startId) + 8);

    await page.keyboard.press("ArrowUp");
    expect(dayOf(await activeTestId()), "Pfeil hoch = -7 Tage").toBe(dayOf(startId) + 1);

    await page.keyboard.press("ArrowLeft");
    expect(dayOf(await activeTestId()), "Pfeil links = -1 Tag").toBe(dayOf(startId));

    // Home/End: Wochenanfang/-ende der aktuellen Zeile.
    await page.keyboard.press("End");
    const endId = await activeTestId();
    await page.keyboard.press("Home");
    const homeId = await activeTestId();
    expect(
      dayOf(endId) - dayOf(homeId),
      "Home und End muessen Anfang/Ende derselben Kalenderwoche treffen",
    ).toBe(6);

    // Enter (1. Mal): Tag wird markiert (Zwei-Stufen-Verhalten, Stufe 1).
    await page.keyboard.press("Enter");
    const focusedId = await activeTestId();
    await expect(desktop.getByTestId(focusedId)).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("shift-dialog")).toHaveCount(0);

    // Nach der Auswahl bleibt genau EINE Zelle in der Tab-Reihenfolge.
    await expect(
      desktop.locator('[data-testid^="day-cell-"][tabindex="0"]'),
      "Roving Tabindex muss auch nach Navigation genau eine Zelle umfassen",
    ).toHaveCount(1);

    // Enter (2. Mal) auf dem markierten Tag: Schicht-Dialog oeffnet (Admin).
    await page.keyboard.press("Enter");
    await expect(
      page.getByTestId("shift-dialog"),
      "Zweites Enter auf dem markierten Tag muss den Schicht-Dialog oeffnen",
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("Monatskalender: Pfeiltasten wechseln ueber die Monatsgrenze in Vor-/Folgemonat", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
  const page = await context.newPage();
  try {
    await loginViaUi(page, acc.email, PASSWORD);
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-grid").click();
    const desktop = page.getByTestId("dienstplan-desktop");
    await expect(desktop.getByTestId("month-grid")).toBeVisible();

    const cells = desktop.locator('[data-testid^="day-cell-"]');
    const monthLabel = page.getByTestId("month-label");
    const startMonth = (await monthLabel.textContent())!.trim();

    const activeTestId = () =>
      page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");

    // Pfeil links auf dem 1. des Monats: Vormonat, Fokus auf dessen letztem Tag.
    await cells.first().focus();
    const firstId = (await activeTestId())!;
    await page.keyboard.press("ArrowLeft");
    await expect(monthLabel, "Pfeil links am Monatsanfang wechselt in den Vormonat").not.toHaveText(
      startMonth,
    );
    const prevCells = desktop.locator('[data-testid^="day-cell-"]');
    const prevLastId = (await prevCells.last().getAttribute("data-testid"))!;
    await expect
      .poll(activeTestId, {
        message: "Fokus muss auf dem letzten Tag des Vormonats landen",
      })
      .toBe(prevLastId);

    // Roving Tabindex bleibt konsistent: genau EINE Zelle tabbable.
    await expect(
      desktop.locator('[data-testid^="day-cell-"][tabindex="0"]'),
      "Auch nach dem Monatswechsel darf nur eine Zelle tabindex=0 tragen",
    ).toHaveCount(1);

    // Pfeil rechts auf dem letzten Tag: zurueck in den Folgemonat, Fokus auf dem 1.
    await page.keyboard.press("ArrowRight");
    await expect(monthLabel, "Pfeil rechts am Monatsende wechselt in den Folgemonat").toHaveText(
      startMonth,
    );
    await expect
      .poll(activeTestId, {
        message: "Fokus muss auf dem ersten Tag des Folgemonats landen",
      })
      .toBe(firstId);

    // Pfeil hoch in der ersten Woche: Vormonat, Fokus 7 Tage zurueck.
    await desktop.getByTestId(firstId).focus();
    await page.keyboard.press("ArrowUp");
    await expect(monthLabel, "Pfeil hoch am Monatsanfang wechselt in den Vormonat").not.toHaveText(
      startMonth,
    );
    const upId = await activeTestId();
    expect(upId, "Pfeil hoch muss eine Zelle im Vormonat fokussieren").toContain("day-cell-");
    expect(upId).not.toBe(firstId);
    await expect(
      desktop.locator('[data-testid^="day-cell-"][tabindex="0"]'),
      "Roving Tabindex bleibt auch nach Pfeil hoch ueber die Grenze konsistent",
    ).toHaveCount(1);
  } finally {
    await context.close();
  }
});
