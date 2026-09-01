import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { openShiftRow, selectDayCell } from "./helpers/shifts";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Regressionstest für den Soft-Close-Warn-Toast
 * (`src/lib/month-closing-warning.ts`):
 *
 * - Monat per API abschließen (POST /month-closings, Premium-Konto)
 * - Im Browser eine Schicht in diesem Monat über den ShiftDialog anlegen
 *   → Warn-Toast „Monat bereits abgeschlossen" erscheint
 * - Zweite Änderung im selben Monat (Schicht bearbeiten)
 *   → KEIN zweiter Toast (einmal pro Monat & Session)
 *
 * Frisches Premium-Konto (Standard-Team via Registrierung), fester Monat
 * März — liegt der März noch in der Zukunft, wird ins Vorjahr ausgewichen
 * (nur VERGANGENE Monate sind abschließbar).
 */

const MONTH = 3;
const now = new Date();
const YEAR = now.getMonth() + 1 > MONTH ? now.getFullYear() : now.getFullYear() - 1;
const DAY = 16;

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const TOAST_TEXT = "Monat bereits abgeschlossen";

let acc: FreeAccount;
let assistantName: string;

/** Navigiert das Monatsgitter per Prev-Klicks bis zum Zielmonat. */
async function gotoMonth(page: Page, year: number, month: number): Promise<void> {
  const targetLabel = `${MONTHS_DE[month - 1]} ${year}`;
  for (let i = 0; i < 30; i++) {
    const label = (await page.getByTestId("month-label").innerText()).trim();
    if (label === targetLabel) return;
    await page.getByTestId("prev-month").click();
  }
  throw new Error(`Zielmonat ${targetLabel} nicht erreicht`);
}

test.beforeAll(async () => {
  acc = await registerFreeAccount("privat", "abschluss-warnung");
  // Premium nötig: Monatsabschluss + Status-Endpunkt sind advancedAnalytics-gegated.
  await setAccountPlan(acc.email, "premium");

  const stamp = Date.now();
  assistantName = `E2E Warnung Assistent ${stamp}`;
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: assistantName,
      email: `e2e.abschluss-warnung.assist.${stamp}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  const assistantId = ((await userRes.json()) as { id: number }).id;

  // Eine FIX-Schicht im Monat, damit der Abschluss Substanz hat.
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      force: true,
      startTime: new Date(`${YEAR}-03-05T08:00:00`).toISOString(),
      endTime: new Date(`${YEAR}-03-05T16:00:00`).toISOString(),
    },
  });
  expect(shiftRes.status(), `Schicht anlegen (${shiftRes.status()})`).toBe(201);

  // Monat abschließen.
  const closeRes = await acc.ctx.post("/api/month-closings", {
    data: { month: MONTH, year: YEAR },
  });
  expect(closeRes.status(), `Abschließen (${closeRes.status()})`).toBe(201);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Warn-Toast erscheint beim Anlegen im abgeschlossenen Monat — aber nur einmal", async ({ page }) => {
  // Login + Monatsnavigation + Toast-Wartezeiten brauchen Luft.
  test.setTimeout(120_000);

  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);

  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const mobile = page.getByTestId("dienstplan-mobile");
  await expect(mobile).toBeVisible();

  await gotoMonth(page, YEAR, MONTH);

  // --- 1. Änderung: Schicht im abgeschlossenen Monat anlegen ---------------
  const mm = String(MONTH).padStart(2, "0");
  const dd = String(DAY).padStart(2, "0");
  const cell = mobile.getByTestId(`day-cell-${YEAR}-${mm}-${dd}`);
  await selectDayCell(page, cell);

  await page.getByTestId("add-shift").click();
  const dialog = page.getByTestId("shift-dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByTestId("shift-dialog-user").click();
  await page.getByRole("option", { name: assistantName }).first().click();
  await dialog.getByTestId("shift-dialog-start").fill("09:00");
  await dialog.getByTestId("shift-dialog-end").fill("13:00");
  await dialog.getByTestId("shift-dialog-save").click();
  await expect(dialog).toHaveCount(0);

  // Warn-Toast erscheint genau einmal.
  const toast = page.getByText(TOAST_TEXT);
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(toast).toHaveCount(1);

  // Toast (Dauer 8s) vollständig verschwinden lassen, damit ein etwaiger
  // ZWEITER Toast unten eindeutig nachweisbar wäre.
  await expect(page.getByText(TOAST_TEXT)).toHaveCount(0, { timeout: 20_000 });

  // --- 2. Änderung im selben Monat: Schicht bearbeiten ---------------------
  const badge = mobile.locator(`[data-testid^="shift-badge-"]`).first();
  await expect(badge).toBeVisible();
  await openShiftRow(page, badge);
  const editDialog = page.getByTestId("shift-dialog");
  await expect(editDialog).toBeVisible();
  await editDialog.getByTestId("shift-dialog-start").fill("10:00");
  await editDialog.getByTestId("shift-dialog-save").click();
  await expect(editDialog).toHaveCount(0);

  // Der Speichervorgang ist durch (Dialog zu); der Warn-Check feuert direkt
  // danach. Kurze feste Wartezeit, dann darf KEIN zweiter Toast da sein.
  await page.waitForTimeout(4_000);
  await expect(page.getByText(TOAST_TEXT)).toHaveCount(0);
});
