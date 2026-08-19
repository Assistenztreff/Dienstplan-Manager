import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { startSelectionMode } from "./helpers/header";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Regressionstest: Massen-Anlegen im bereits abgeschlossenen Monat zeigt
 * genau EINEN Warn-Toast und feuert genau EINE Statusabfrage.
 *
 * `handleBulkSave` (shift-dialog.tsx) ruft `warnIfMonthClosed` pro
 * ausgewähltem Tag auf — alle im selben Tick. Der Cache in
 * `month-closing-warning.ts` (Boolean-Cache + In-Flight-Dedupe) muss dabei
 * verhindern, dass pro Tag ein eigener Toast bzw. eine eigene
 * GET /month-closings-Abfrage entsteht. Eine Regression würde Nutzer mit
 * Toast-Spam fluten oder (bei kaputtem Cache-Key) still bleiben.
 *
 * Ablauf:
 * - Frisches Premium-Konto (Monatsabschluss ist advancedAnalytics-gegated)
 * - Monat März (Vorjahr, falls März noch nicht vorbei) per API abschließen
 * - Auswahl-Modus (Desktop-Tabellenansicht) → drei Tage wählen → Bulk-Anlegen
 *   (Urlaub, braucht kein Schichtmodell)
 * - Genau EIN Warn-Toast; GET /month-closings genau EINMAL gefeuert
 */

const MONTH = 3;
const now = new Date();
const YEAR = now.getMonth() + 1 > MONTH ? now.getFullYear() : now.getFullYear() - 1;
const DAYS = [10, 11, 12];

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const TOAST_TEXT = "Monat bereits abgeschlossen";

// Auswahl-Modus über klickbare Spalten-Header (col-header-*) existiert nur in
// der Desktop-Tabellenansicht.
test.use({ viewport: { width: 1280, height: 900 } });

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
  acc = await registerFreeAccount("privat", "abschluss-warnung-bulk");
  // Premium nötig: Monatsabschluss + Status-Endpunkt sind advancedAnalytics-gegated.
  await setAccountPlan(acc.email, "premium");

  const stamp = Date.now();
  assistantName = `E2E Bulk-Warnung Assistent ${stamp}`;
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: assistantName,
      email: `e2e.abschluss-warnung-bulk.assist.${stamp}@dienstplan.test`,
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

test("Bulk-Anlegen im abgeschlossenen Monat: genau EIN Warn-Toast, EINE Statusabfrage", async ({ page }) => {
  // Login + Monatsnavigation + Toast-Wartezeiten brauchen Luft.
  test.setTimeout(120_000);

  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);

  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  await expect(page.getByTestId("dienstplan-desktop")).toBeVisible();
  await expect(
    page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-table"),
  ).toHaveAttribute("data-active", "true");

  await gotoMonth(page, YEAR, MONTH);

  // Auswahl-Modus aktivieren und drei Tage im abgeschlossenen Monat wählen.
  await startSelectionMode(page);
  const mm = String(MONTH).padStart(2, "0");
  for (const d of DAYS) {
    const header = page.getByTestId(`col-header-${YEAR}-${mm}-${String(d).padStart(2, "0")}`);
    await header.click();
    await expect(header).toHaveAttribute("data-selected", "true");
  }
  await expect(page.getByTestId("bulk-selected-count")).toHaveText("3 Tage ausgewählt");

  // Bulk-Anlegen-Dialog öffnen und ausfüllen (Urlaub: kein Schichtmodell nötig).
  await page.getByTestId("bulk-create-open").click();
  const dialog = page.getByTestId("shift-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("shift-dialog-bulk-summary")).toContainText("3 Tage ausgewählt");

  await dialog.getByTestId("shift-dialog-user").click();
  await page.getByRole("option", { name: assistantName }).first().click();
  await dialog.getByTestId("shift-dialog-type").click();
  await page.getByRole("option", { name: "Urlaub" }).first().click();

  // Ab jetzt jede Statusabfrage des Soft-Close-Checks mitzählen.
  const statusRequests: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") return;
    const url = new URL(req.url());
    if (!url.pathname.endsWith("/api/month-closings")) return;
    if (url.searchParams.get("month") === String(MONTH) && url.searchParams.get("year") === String(YEAR)) {
      statusRequests.push(url.toString());
    }
  });

  await dialog.getByTestId("shift-dialog-save").click();
  await expect(dialog).toHaveCount(0);

  // Genau EIN Warn-Toast — nicht drei (einer pro Tag).
  const toast = page.getByText(TOAST_TEXT);
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(toast).toHaveCount(1);

  // Kurz warten (Toast-Dauer 8 s, weitere Toasts hätten längst gefeuert) —
  // es bleibt bei genau einem.
  await page.waitForTimeout(2_500);
  await expect(page.getByText(TOAST_TEXT)).toHaveCount(1);

  // Netzwerk-Assertion: GET /month-closings genau EINMAL für (Monat, Team).
  expect(
    statusRequests,
    `Erwartet genau 1 Statusabfrage, gesehen: ${statusRequests.length}\n${statusRequests.join("\n")}`,
  ).toHaveLength(1);
});
