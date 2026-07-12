import { test, expect, type Page } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * E2E-Test für die Zähler-Kacheln des Dashboards:
 * "Aktive Assistenten", "Schichten Heute" und "Offene Zeiteinträge".
 *
 * Der bestehende Navigations-Test (dienstplan-dashboard-kpis.spec.ts) prüft nur,
 * wohin diese drei Kacheln springen — NICHT, ob die angezeigten Zahlen stimmen.
 * (Die vierte Kachel "Stundenbilanz Monat" deckt
 * dienstplan-dashboard-hours-balance.spec.ts wertmäßig ab.) Dieser Test schließt
 * die Lücke und deckt Fehler in den Summary-Zählern (totalAssistants,
 * activeShiftsToday, pendingTimeEntries) früh auf.
 *
 * Aufbau:
 * - Ein frisch registriertes Dienstleister-Konto (TeamTestHarness)
 *   bekommt ein frisches, isoliertes Team. So sind die team-gescopten
 *   Aggregate des Summary exakt die hier angelegten Fixture-Daten (keine
 *   Kollision mit Bestandsdaten).
 * - Genau ZWEI Assistenten werden dem Team zugeordnet -> "Aktive Assistenten" = 2.
 * - Eine Schicht startet HEUTE (Mittag, zeitzonensicher) -> "Schichten Heute" = 1;
 *   eine Kontroll-Schicht an einem anderen Tag darf NICHT mitzählen.
 * - ZWEI Ist-Zeiten bleiben "pending" -> "Offene Zeiteinträge" = 2; eine
 *   zusätzliche, bestätigte Ist-Zeit darf NICHT mitzählen.
 *
 * Geprüft (Done-Kriterien):
 * - Test öffnet das Dashboard, wählt das Test-Team im Team-Umschalter und prüft,
 *   dass kpi-active-assistants, kpi-shifts-today und kpi-pending-time-entries die
 *   erwarteten Zahlen zeigen.
 * - Alle Fixture-Daten werden in afterAll FK-sicher wieder entfernt und der
 *   accountType des Admins zurückgesetzt.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const now = new Date();
const pad2 = (n: number) => String(n).padStart(2, "0");
// Heutiges Datum (lokale Zeit), wie es die App über `format(now, "yyyy-MM-dd")`
// ermittelt. Die Schicht startet mittags (12:00Z) — damit liegt sie auch bei
// üblichen Server-Zeitzonenversätzen sicher innerhalb des Heute-Fensters, das
// der Server aus seiner lokalen Mitternacht berechnet.
const TODAY = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
// Kontroll-Tag: weit weg von heute (Monatsmitte des Vormonats), zählt NICHT als
// "heute".
const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
const OTHER_DAY = `${prevMonth.getFullYear()}-${pad2(prevMonth.getMonth() + 1)}-${pad2(prevMonth.getDate())}`;

// Erwartete Zähler aus den Fixture-Daten.
const EXPECTED_ASSISTANTS = 2;
const EXPECTED_SHIFTS_TODAY = 1;
const EXPECTED_PENDING = 2;

let h: TeamTestHarness;
let teamId: number;
let teamName: string;

async function loginAsAdmin(page: Page): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
  // der Vite-Dev-Auto-Login greift nie (dev- UND prod-tauglich).
  // Login als das vom Harness registrierte Dienstleister-Konto (die Fixture-
  // Daten und das Team gehören diesem Konto, nicht mehr dem Setup-Admin).
  const res = await page.request.post("/api/auth/login", {
    data: { email: h.email, password: h.password },
  });
  expect(res.ok(), `Admin-Login fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  teamName = `E2E Counter Team ${h.run}`;
  teamId = await h.createTeam(teamName);

  // Aktive Assistenten: genau zwei Mitglieder im Team.
  const assistantA = await h.createUser({ teamId, role: "assistant" });
  const assistantB = await h.createUser({ teamId, role: "assistant" });

  // Schichten Heute: eine Schicht mit Start HEUTE (zählt), eine an einem anderen
  // Tag (zählt NICHT).
  await h.createShift(teamId, assistantA, TODAY, {
    startTime: `${TODAY}T12:00:00.000Z`,
    endTime: `${TODAY}T18:00:00.000Z`,
  });
  await h.createShift(teamId, assistantB, OTHER_DAY, {
    startTime: `${OTHER_DAY}T08:00:00.000Z`,
    endTime: `${OTHER_DAY}T16:00:00.000Z`,
  });

  // Offene Zeiteinträge: zwei bleiben "pending" (zählen), einer wird bestätigt
  // (zählt NICHT).
  await h.createTimeEntry(teamId, assistantA, TODAY, {
    actualStart: `${TODAY}T12:00:00.000Z`,
    actualEnd: `${TODAY}T18:00:00.000Z`,
  });
  await h.createTimeEntry(teamId, assistantB, OTHER_DAY, {
    actualStart: `${OTHER_DAY}T08:00:00.000Z`,
    actualEnd: `${OTHER_DAY}T12:00:00.000Z`,
  });

  const confirmedEntry = await h.createTimeEntry(teamId, assistantA, OTHER_DAY, {
    actualStart: `${OTHER_DAY}T18:00:00.000Z`,
    actualEnd: `${OTHER_DAY}T22:00:00.000Z`,
  });
  const res = await h.ctx.patch(`/api/time-tracking/${confirmedEntry}/confirm`, {
    data: { status: "confirmed", confirmedBy: h.adminId },
  });
  expect(res.ok(), `Bestätigen der Ist-Zeit fehlgeschlagen (${res.status()})`).toBe(true);
});

test.afterAll(async () => {
  await h.cleanup();
});

test.describe("Dashboard: Zähler-Kacheln zeigen korrekte Werte", () => {
  test("Aktive Assistenten, Schichten Heute und Offene Zeiteinträge", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

    // Auf das isolierte Test-Team umschalten, damit die team-gescopten Aggregate
    // exakt den Fixture-Daten entsprechen.
    const switcher = page.getByLabel("Team auswählen");
    await expect(switcher).toBeVisible();
    await switcher.click();
    await page.getByRole("option", { name: teamName }).click();

    // Nach dem Refetch müssen die drei Zähler exakt den Fixture-Daten entsprechen.
    await expect(page.getByTestId("kpi-active-assistants")).toContainText(
      String(EXPECTED_ASSISTANTS),
    );
    await expect(page.getByTestId("kpi-shifts-today")).toContainText(
      String(EXPECTED_SHIFTS_TODAY),
    );
    await expect(page.getByTestId("kpi-pending-time-entries")).toContainText(
      String(EXPECTED_PENDING),
    );
  });
});
