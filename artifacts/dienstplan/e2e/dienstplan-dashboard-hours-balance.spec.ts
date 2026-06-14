import { test, expect, type Page } from "@playwright/test";
import { TeamTestHarness, ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers/teams";

/**
 * E2E-Test für die Werte der KPI-Kachel "Stundenbilanz Monat" auf dem Dashboard.
 *
 * Der bestehende Navigations-Test (dienstplan-dashboard-kpis.spec.ts) prüft nur,
 * wohin die Kacheln springen — NICHT, ob die angezeigten Zahlen stimmen. Dieser
 * Test schließt die Lücke und deckt Berechnungsfehler im Soll/Ist-Abgleich des
 * Dashboard-Summary früh auf.
 *
 * Aufbau:
 * - Der Setup-Admin wird zur Laufzeit auf accountType "dienstleister" geschaltet
 *   und bekommt ein frisches, isoliertes Team mit genau einem Assistenten. So
 *   sind die team-gescopten Aggregate des Summary exakt die hier angelegten
 *   Fixture-Daten (keine Kollision mit Bestandsdaten).
 * - Geplante Schichten im aktuellen Monat liefern die Soll-Stunden:
 *   8h + 6h = 14h.
 * - Bestätigte Ist-Zeiten im aktuellen Monat liefern die Ist-Stunden:
 *   8h + 5h = 13h (nur "confirmed" zählt — ein zusätzlicher pending-Eintrag
 *   wird bewusst NICHT mitgezählt).
 *
 * Geprüft (Done-Kriterien):
 * - Test öffnet das Dashboard, wählt das Test-Team im Team-Umschalter und prüft,
 *   dass kpi-hours-balance die erwarteten Ist-/Soll-Stunden ("13 / 14 h") zeigt.
 * - Alle Fixture-Daten werden in afterAll FK-sicher wieder entfernt und der
 *   accountType des Admins zurückgesetzt.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1;
const pad2 = (n: number) => String(n).padStart(2, "0");
// Feste Tage in der Monatsmitte: immer gültig und ohne Zeitzonen-Monatsrolle.
const DAY_A = `${YEAR}-${pad2(MONTH)}-10`;
const DAY_B = `${YEAR}-${pad2(MONTH)}-11`;

// Erwartete Aggregate aus den Fixture-Daten.
const EXPECTED_PLANNED = 14; // 8h (DAY_A) + 6h (DAY_B)
const EXPECTED_ACTUAL = 13; // 8h (DAY_A) + 5h (DAY_B), nur bestätigt

let h: TeamTestHarness;
let teamId: number;
let teamName: string;

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  teamName = `E2E KPI Team ${h.run}`;
  teamId = await h.createTeam(teamName);
  const assistant = await h.createUser({ teamId, role: "assistant" });

  // Soll-Stunden: zwei geplante Schichten (8h + 6h = 14h).
  await h.createShift(teamId, assistant, DAY_A, {
    startTime: `${DAY_A}T08:00:00.000Z`,
    endTime: `${DAY_A}T16:00:00.000Z`,
  });
  await h.createShift(teamId, assistant, DAY_B, {
    startTime: `${DAY_B}T08:00:00.000Z`,
    endTime: `${DAY_B}T14:00:00.000Z`,
  });

  // Ist-Stunden: zwei Ist-Zeiten (8h + 5h), die anschließend bestätigt werden.
  const teA = await h.createTimeEntry(teamId, assistant, DAY_A, {
    actualStart: `${DAY_A}T08:00:00.000Z`,
    actualEnd: `${DAY_A}T16:00:00.000Z`,
  });
  const teB = await h.createTimeEntry(teamId, assistant, DAY_B, {
    actualStart: `${DAY_B}T08:00:00.000Z`,
    actualEnd: `${DAY_B}T13:00:00.000Z`,
  });
  for (const id of [teA, teB]) {
    const res = await h.ctx.patch(`/api/time-tracking/${id}/confirm`, {
      data: { status: "confirmed", confirmedBy: h.adminId },
    });
    expect(res.ok(), `Bestätigen der Ist-Zeit fehlgeschlagen (${res.status()})`).toBe(true);
  }

  // Kontroll-Eintrag: bleibt "pending" und darf NICHT in die Ist-Stunden fließen.
  await h.createTimeEntry(teamId, assistant, DAY_A, {
    actualStart: `${DAY_A}T18:00:00.000Z`,
    actualEnd: `${DAY_A}T22:00:00.000Z`,
  });
});

test.afterAll(async () => {
  await h.cleanup();
});

test.describe("Dashboard: Stundenbilanz-Kachel zeigt korrekte Werte", () => {
  test("kpi-hours-balance zeigt bestätigte Ist- und geplante Soll-Stunden", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

    // Auf das isolierte Test-Team umschalten, damit die team-gescopten Aggregate
    // exakt den Fixture-Daten entsprechen.
    const switcher = page.getByLabel("Team auswählen");
    await expect(switcher).toBeVisible();
    await switcher.click();
    await page.getByRole("option", { name: teamName }).click();

    // Die Kachel zeigt "<Ist> / <Soll> h"; nach dem Refetch müssen es genau die
    // erwarteten Aggregate sein.
    const tile = page.getByTestId("kpi-hours-balance");
    await expect(tile).toContainText(
      new RegExp(`${EXPECTED_ACTUAL}\\s*/\\s*${EXPECTED_PLANNED}\\s*h`),
    );
  });
});
