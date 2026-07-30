import { test, expect } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Task #677 — ZIP-Download-Button: Premium sichtbar/aktiv, Free deaktiviert.
 *
 * Der "ZIP Export"-Button (data-testid="export-zip-button") auf /auswertungen
 * ist das Frontend-Gate für das payrollExport-Premium-Feature:
 *
 *   Free-Plan  → Button deaktiviert (aria-disabled/disabled), Tooltip zeigt
 *                den Hinweis auf das Premium-Feature.
 *   Premium    → Button aktiv, sobald Auswertungsdaten im gewählten Monat
 *                vorhanden sind.
 *
 * Desktop-Viewport: Header mit Buttons ist vollständig sichtbar.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NOW = new Date();
/** Vormonat: Schicht/Vertrag dort angelegt, ein Klick "zurück" landet garantiert hier. */
const TARGET = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const TARGET_YEAR = TARGET.getFullYear();
const TARGET_MM = String(TARGET.getMonth() + 1).padStart(2, "0");
const SHIFT_DAY = `${TARGET_YEAR}-${TARGET_MM}-15`;

// ---- Free-Plan-Konto --------------------------------------------------------
let freeAcc: FreeAccount;

// ---- Premium-Konto mit Daten -----------------------------------------------
let premiumAcc: FreeAccount;
let premiumShiftId: number;

test.beforeAll(async () => {
  test.setTimeout(120_000);

  // Free-Konto: ZIP-Button soll deaktiviert sein
  freeAcc = await registerFreeAccount("dienstleister", "zipreport-free");

  // Premium-Konto + Assistent + Vertrag + Schicht im Vormonat
  premiumAcc = await registerFreeAccount("dienstleister", "zipreport-prem");
  await setAccountPlan(premiumAcc.email, "premium");

  const unique = Date.now();
  const userRes = await premiumAcc.ctx.post("/api/users", {
    data: {
      name: `E2E ZIP Assistent ${unique}`,
      email: `e2e.zip.asst.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status()).toBe(201);
  const assistantId = ((await userRes.json()) as { id: number }).id;

  await premiumAcc.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${TARGET_YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });

  const shiftRes = await premiumAcc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      startTime: `${SHIFT_DAY}T08:00:00.000Z`,
      endTime: `${SHIFT_DAY}T16:00:00.000Z`,
    },
  });
  expect(shiftRes.status(), `Schicht anlegen (${shiftRes.status()})`).toBe(201);
  premiumShiftId = ((await shiftRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (premiumShiftId) await premiumAcc.ctx.delete(`/api/shifts/${premiumShiftId}`);
  await deleteFreeAccount(freeAcc);
  await deleteFreeAccount(premiumAcc);
});

test("Free-Plan: ZIP-Export-Button ist deaktiviert (#677)", async ({ page }) => {
  test.setTimeout(45_000);

  await loginViaUi(page, freeAcc.email, FREE_ACCOUNT_PASSWORD);
  await page.goto("/auswertungen");

  // Seite vollständig geladen
  await expect(page.getByTestId("month-label")).toBeVisible({ timeout: 20_000 });

  const zipBtn = page.getByTestId("export-zip-button");
  await expect(zipBtn, "ZIP-Button muss im Free-Plan sichtbar sein").toBeVisible({
    timeout: 10_000,
  });

  // Disabled-Attribut oder aria-disabled gesetzt
  const isDisabled =
    (await zipBtn.getAttribute("disabled")) !== null ||
    (await zipBtn.getAttribute("aria-disabled")) === "true";
  expect(isDisabled, "ZIP-Button muss im Free-Plan deaktiviert sein").toBe(true);
});

test("Premium-Plan: ZIP-Export-Button ist aktiv wenn Auswertungsdaten vorhanden (#677)", async ({
  page,
}) => {
  test.setTimeout(45_000);

  await loginViaUi(page, premiumAcc.email, FREE_ACCOUNT_PASSWORD);
  await page.goto("/auswertungen");

  // Zum Vormonat navigieren (dort liegen die Daten)
  await expect(page.getByTestId("month-label")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("month-prev").click();

  // Auswertungsdaten laden abwarten (Balances sollen vorhanden sein)
  await page.waitForTimeout(2_000);

  const zipBtn = page.getByTestId("export-zip-button");
  await expect(zipBtn, "ZIP-Button muss im Premium-Plan sichtbar sein").toBeVisible({
    timeout: 10_000,
  });

  // Nicht deaktiviert
  const isDisabled =
    (await zipBtn.getAttribute("disabled")) !== null ||
    (await zipBtn.getAttribute("aria-disabled")) === "true";
  expect(isDisabled, "ZIP-Button darf im Premium-Plan mit Daten NICHT deaktiviert sein").toBe(
    false,
  );
});
