/**
 * #599 – Bestätigen, dass der Vortags-Nachtdienst-Hinweis im Urlaubs-Dialog
 *        zuverlässig erscheint.
 *
 * Ablauf:
 * 1. Dienstleister-Konto + Assistent anlegen.
 * 2. FIX-Nachtdienst via API: Tag 4 22:00 UTC → Tag 5 06:00 UTC.
 * 3. Im Dienstplan Assistenten auswählen, Tag 5 anklicken.
 * 4. Im Schicht-Dialog Typ „Urlaub" wählen.
 * 5. data-testid="shift-dialog-overhang-hint" muss sichtbar sein.
 */
import { format } from "date-fns";
import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

const NOW = new Date();
const YEAR = NOW.getFullYear();
const MONTH = NOW.getMonth() + 1;
const MM = String(MONTH).padStart(2, "0");

const NIGHT_START = `${YEAR}-${MM}-04T22:00:00.000Z`;
const NIGHT_END = `${YEAR}-${MM}-05T06:00:00.000Z`;
const VACATION_DATE_KEY = format(new Date(YEAR, MONTH - 1, 5), "yyyy-MM-dd");

let acc: FreeAccount;
let assistantId: number;
let shiftId: number;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  acc = await registerFreeAccount("dienstleister", "vortnacht");
  await setAccountPlan(acc.email, "premium");

  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E VortNacht ${Date.now()}`,
      email: `e2e.vortnacht.${Date.now()}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  await acc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });

  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "night",
      planningStatus: "FIX",
      startTime: NIGHT_START,
      endTime: NIGHT_END,
    },
  });
  expect(
    shiftRes.status(),
    `Nachtdienst anlegen (${shiftRes.status()}: ${await shiftRes.text()})`,
  ).toBe(201);
  shiftId = ((await shiftRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (shiftId) await acc.ctx.delete(`/api/shifts/${shiftId}`);
  await deleteFreeAccount(acc);
});

test(
  "Vortags-Nachtdienst-Hinweis erscheint im Urlaubs-Dialog (#599)",
  async ({ page }) => {
    test.setTimeout(60_000);

    // Cookies aus dem API-Kontext in den Browser übertragen — der Browser agiert
    // damit als das registrierte Dienstleister-Konto (kein Auto-Dev-Login).
    const state = await acc.ctx.storageState();
    await page.context().addCookies(state.cookies);
    await page.goto("/dienstplan");

    const assistantSelect = page.locator('[data-testid="assistant-select"]');
    await assistantSelect.waitFor({ state: "visible", timeout: 12_000 });
    await assistantSelect.click();

    const assistantOption = page.locator(
      `[data-testid="assistant-option-${assistantId}"]`,
    );
    await assistantOption.waitFor({ state: "visible", timeout: 5_000 });
    await assistantOption.click();

    const vacationCell = page
      .locator(`[data-testid="day-cell-${VACATION_DATE_KEY}"]`)
      .first();
    await vacationCell.waitFor({ state: "visible", timeout: 10_000 });
    await vacationCell.click();

    const dialog = page.locator('[data-testid="shift-dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 8_000 });

    const typeSelect = dialog.locator('[data-testid="shift-dialog-type"]');
    await typeSelect.click();
    const vacationOption = page.getByRole("option", { name: /^Urlaub$/i });
    await vacationOption.waitFor({ state: "visible", timeout: 5_000 });
    await vacationOption.click();

    const hint = dialog.locator('[data-testid="shift-dialog-overhang-hint"]');
    await expect(hint).toBeVisible({ timeout: 6_000 });
    await expect(hint).toContainText(/Hinweis.*Vortag/i);
  },
);
