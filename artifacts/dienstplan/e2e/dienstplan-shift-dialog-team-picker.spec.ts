import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { selectDayCell } from "./helpers/shifts";
import { TeamTestHarness, FREE_ACCOUNT_PASSWORD } from "./helpers/teams";

/**
 * Klick-Test (#479): Der Assistenten-Picker im Dienst-Dialog ist strikt
 * team-gebunden.
 *
 * Hintergrund: Die frühere Aushilfen-Funktion (teamübergreifende Personenwahl
 * mit einer Gruppe „Aushilfen aus anderen Teams") wurde zurückgebaut (#478).
 * Die API ist per e2e-api-Spec abgesichert (403 bei teamfremden Nutzern) —
 * dieser UI-Test verifiziert den eigentlichen Picker: Ein Dienstleister mit
 * 2 Teams sieht im Dienst-Dialog von Team A ausschließlich Mitglieder von
 * Team A; nach dem Team-Wechsel ausschließlich Mitglieder von Team B.
 *
 * Aufbau: Frisch registriertes Dienstleister-Konto (Premium via DB-Helfer,
 * sonst greift das Free-Team-Limit), zweites Team "B" per API, je ein eindeutig
 * benannter Assistent pro Team — alles VOR dem Seitenaufruf (React Query
 * cached beim Laden; siehe Memory-Notiz "Seed e2e data before goto").
 */

let h: TeamTestHarness;
let standardTeamId: number; // Team A = bei der Registrierung angelegtes Standard-Team
let teamBId: number;

const STAMP = Date.now();
const TEAM_B_NAME = `E2E Picker Team B ${STAMP}`;
const ASSISTANT_A_NAME = `E2E Picker Alice ${STAMP}`;
const ASSISTANT_B_NAME = `E2E Picker Bob ${STAMP}`;

test.beforeAll(async () => {
  // Registrierung + Plan-Umstellung können beim Cold-Start länger dauern.
  test.setTimeout(120_000);

  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  // Standard-Team (bei der Registrierung angelegt) ermitteln — der
  // TeamSwitcher wählt ohne persistierte Auswahl automatisch das ERSTE Team.
  const teamsRes = await h.ctx.get("/api/teams");
  expect(teamsRes.ok()).toBe(true);
  const teams = (await teamsRes.json()) as { id: number; name: string }[];
  expect(teams.length).toBe(1);
  standardTeamId = teams[0].id;

  teamBId = await h.createTeam(TEAM_B_NAME);

  await h.createUser({
    name: ASSISTANT_A_NAME,
    role: "assistant",
    teamId: standardTeamId,
  });
  await h.createUser({
    name: ASSISTANT_B_NAME,
    role: "assistant",
    teamId: teamBId,
  });
});

test.afterAll(async () => {
  await h?.cleanup();
});

/**
 * Öffnet auf /dienstplan (mobile Ansicht) den Dienst-Dialog über die
 * Tagesauswahl + "Schicht erstellen" und gibt den Dialog-Locator zurück.
 */
async function openShiftDialog(page: Page) {
  const mobile = page.getByTestId("dienstplan-mobile");
  await expect(mobile).toBeVisible();

  // Tag 15 existiert in jedem Monat; das frische Konto hat keine Schichten.
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const cell = mobile.getByTestId(`day-cell-${now.getFullYear()}-${mm}-15`);
  await selectDayCell(page, cell);

  await mobile.getByTestId("add-shift").click();
  const dialog = page.getByTestId("shift-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Schließt einen offenen Picker (Popover) und danach den Dialog per Escape.
 * Zwischen den beiden Escapes wird gewartet, bis das Popover wirklich weg ist —
 * sonst verschluckt dessen Schließ-Animation den zweiten Tastendruck.
 */
async function closeDialog(page: Page) {
  await page.keyboard.press("Escape"); // Popover zu
  await expect(page.getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Escape"); // Dialog zu
  await expect(page.getByTestId("shift-dialog")).toHaveCount(0);
}

test.describe("Dienst-Dialog: Assistenten-Picker ist strikt team-gebunden", () => {
  test("Team A zeigt nur Team-A-Assistenten, nach Team-Wechsel nur Team B", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await loginViaUi(page, h.email, FREE_ACCOUNT_PASSWORD);
    await page.goto("/dienstplan");
    await expect(
      page.getByRole("heading", { name: "Dienstplan", exact: true }),
    ).toBeVisible();

    // --- Team A (Standard-Team, Auto-Auswahl des TeamSwitchers) ------------
    const dialogA = await openShiftDialog(page);
    await dialogA.getByTestId("shift-dialog-user").click();

    // Nur der Team-A-Assistent wird gelistet ...
    await expect(
      page.getByRole("option", { name: ASSISTANT_A_NAME }),
    ).toBeVisible();
    // ... der Team-B-Assistent NICHT, ...
    await expect(page.getByRole("option", { name: ASSISTANT_B_NAME })).toHaveCount(0);
    // ... und es gibt keine teamübergreifende Gruppe mehr.
    await expect(page.getByText(/Aushilfen aus anderen Teams/i)).toHaveCount(0);

    await closeDialog(page);

    // --- Auf Team B umschalten (TeamSwitcher in der Kopfzeile) --------------
    await page.getByLabel("Team auswählen").click();
    await page.getByRole("option", { name: TEAM_B_NAME }).click();

    // Warten, bis die team-gefilterte Assistentenliste umgeschwenkt ist,
    // dann den Dialog erneut öffnen.
    const dialogB = await openShiftDialog(page);
    await dialogB.getByTestId("shift-dialog-user").click();

    // Jetzt exakt umgekehrt: nur der Team-B-Assistent.
    await expect(
      page.getByRole("option", { name: ASSISTANT_B_NAME }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: ASSISTANT_A_NAME })).toHaveCount(0);
    await expect(page.getByText(/Aushilfen aus anderen Teams/i)).toHaveCount(0);

    await closeDialog(page);
  });
});
