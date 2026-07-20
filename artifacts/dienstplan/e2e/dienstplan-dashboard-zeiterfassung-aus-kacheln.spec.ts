import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  deleteFreeAccount,
  registerFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Browser-Test: Konto-Schalter "Zeiterfassung aktivieren" steuert die
 * Dashboard-Kacheln.
 *
 * - AUS (Standard bei neuen Konten): Die Zeiterfassungs-Kacheln
 *   "Offene Zeiteinträge" (kpi-pending-time-entries) und "Stundenbilanz Monat"
 *   (kpi-hours-balance) werden NICHT gerendert; stattdessen erscheint die
 *   Kachel "Geplante Stunden (Monat)" (kpi-planned-hours).
 * - EIN: Umgekehrt — beide Zeiterfassungs-Kacheln sichtbar, die
 *   Plan-Stunden-Kachel verschwindet.
 *
 * Der Schalter wird über PUT /api/allowance-settings umgelegt (eigenes,
 * frisch registriertes Konto — der geteilte Seed-Admin bleibt unberührt,
 * damit parallel laufende Specs nicht gestört werden).
 */

let acc: FreeAccount;

/** Legt den Zeiterfassungs-Schalter um, ohne andere Einstellungen zu ändern. */
async function setTimeTracking(enabled: boolean): Promise<void> {
  const putRes = await acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: 25,
      nightStart: "23:00",
      nightEnd: "06:00",
      sundayPercent: 50,
      holidayPercent: 100,
      timeTrackingEnabled: enabled,
    },
  });
  expect(putRes.ok(), `PUT allowance-settings fehlgeschlagen (${putRes.status()})`).toBe(true);
  const body = (await putRes.json()) as { timeTrackingEnabled: boolean };
  expect(body.timeTrackingEnabled).toBe(enabled);
}

/** Öffnet das Dashboard und wartet, bis die KPI-Kacheln gerendert sind. */
async function openDashboard(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByTestId("kpi-active-assistants")).toBeVisible();
}

test.beforeAll(async () => {
  acc = await registerFreeAccount("privat", "ttdashkacheln");
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test.beforeEach(async ({ page }) => {
  await loginViaUi(page, acc.email, FREE_ACCOUNT_PASSWORD);
});

test("AUS: keine Zeiterfassungs-Kacheln, dafür 'Geplante Stunden (Monat)'", async ({ page }) => {
  await setTimeTracking(false);
  await openDashboard(page);

  await expect(page.getByTestId("kpi-planned-hours")).toBeVisible();
  await expect(page.getByTestId("kpi-pending-time-entries")).toHaveCount(0);
  await expect(page.getByTestId("kpi-hours-balance")).toHaveCount(0);
});

test("EIN: Zeiterfassungs-Kacheln sichtbar, Plan-Stunden-Kachel weg", async ({ page }) => {
  await setTimeTracking(true);
  await openDashboard(page);

  await expect(page.getByTestId("kpi-pending-time-entries")).toBeVisible();
  await expect(page.getByTestId("kpi-hours-balance")).toBeVisible();
  await expect(page.getByTestId("kpi-planned-hours")).toHaveCount(0);
});
