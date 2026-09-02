import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  TeamTestHarness,
  registerFreeAccount,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";
import { DEFAULT_SHIFT_MODELS } from "@workspace/shift-defaults";

/**
 * E2E-Test für den Team-Filter im Dienste-Bereich der Einstellungen (#486).
 *
 * Der Bereich "Dienste" hat ein Team-Dropdown (data-testid "model-team-filter",
 * nur Dienstleister): Die Modell-Liste ist team-gefiltert, und eine Neuanlage
 * über den Dialog landet im DORT gewählten Team — nicht im global (über den
 * Team-Switcher) gewählten. Ohne diesen Test könnte eine Regression Neuanlagen
 * still ins falsche Team lenken.
 *
 * Aufbau: Frisch registriertes Dienstleister-Konto (Premium via DB-Helfer),
 * zweites Team "B" per API. Je ein eindeutig benanntes Marker-Modell pro Team
 * (per API, VOR dem Seitenaufruf — React Query cached beim Laden).
 *
 * Geprüft (Done-Kriterien):
 * - Dropdown sichtbar; Umschalten filtert die Liste (Marker A vs. Marker B).
 * - Neuanlage über den Dialog bei Dropdown=Team B (globaler Switcher steht
 *   weiter auf dem Standard-Team) landet per API-Nachweis NUR in Team B.
 * - Privat-Konto: kein Dropdown (data-testid fehlt), Liste trotzdem da.
 */

type Entity = { id: number };
type Model = { id: number; name: string };

let h: TeamTestHarness;
let privatAcc: FreeAccount | undefined;

let standardTeamId: number;
let teamB: number;
let markerA = 0; // Marker-Modell im Standard-Team
let markerB = 0; // Marker-Modell in Team B

const MARKER_A_NAME = `E2E Marker A ${Date.now()}`;
const MARKER_B_NAME = `E2E Marker B ${Date.now()}`;
const NEW_MODEL_NAME = `E2E Neuanlage B ${Date.now()}`;

async function createModel(teamId: number, name: string): Promise<number> {
  const res = await h.ctx.post("/api/shift-models", {
    data: {
      name,
      valuationPercent: 100,
      sortOrder: 999,
      isActive: true,
      teamId,
    },
  });
  expect(res.ok(), `Modell anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

async function listModels(teamId: number): Promise<Model[]> {
  const res = await h.ctx.get(`/api/shift-models?teamId=${teamId}`);
  expect(res.ok(), `Modelle laden fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Model[];
}

async function gotoEinstellungen(page: Page): Promise<void> {
  await page.goto("/einstellungen");
  // Warten, bis der Dienste-Bereich geladen ist (Skeletons weg).
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
}

test.beforeAll(async () => {
  // Registrierung + Plan-Umstellung können beim Cold-Start länger dauern.
  test.setTimeout(120_000);

  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  // Standard-Team (bei der Registrierung angelegt) ermitteln.
  const teamsRes = await h.ctx.get("/api/teams");
  expect(teamsRes.ok()).toBe(true);
  const teams = (await teamsRes.json()) as { id: number; name: string }[];
  expect(teams.length).toBe(1);
  standardTeamId = teams[0].id;

  teamB = await h.createTeam(`E2E Dienste-Filter Team B ${h.run}`);

  // Marker-Modelle VOR jedem Seitenaufruf anlegen (React Query cached beim Laden).
  markerA = await createModel(standardTeamId, MARKER_A_NAME);
  markerB = await createModel(teamB, MARKER_B_NAME);

  privatAcc = await registerFreeAccount("privat", "dienstefilter");
});

test.afterAll(async () => {
  // Team B muss vor h.cleanup() datenfrei sein (DELETE /teams sonst 409):
  // Marker, Neuanlage UND die beim Team-Anlegen geseedeten Standard-Modelle.
  try {
    for (const m of await listModels(teamB)) {
      await h.ctx.delete(`/api/shift-models/${m.id}`);
    }
  } catch {
    /* Best effort */
  }
  if (markerA) {
    try {
      await h.ctx.delete(`/api/shift-models/${markerA}`);
    } catch {
      /* ignore */
    }
  }
  await deleteFreeAccount(privatAcc);
  await h?.cleanup();
});

test.describe("Dienste-Bereich: Team-Filter lenkt Liste und Neuanlagen", () => {
  test("Dienstleister: Dropdown filtert die Modell-Liste, Neuanlage landet im gewählten Team", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await loginViaUi(page, h.email, FREE_ACCOUNT_PASSWORD);
    await gotoEinstellungen(page);

    // Dropdown vorhanden; initial folgt es dem globalen Team-Switcher
    // (Standard-Team, das erste Team) -> Marker A sichtbar, Marker B nicht.
    const filter = page.getByTestId("model-team-filter");
    await expect(filter).toBeVisible();
    await expect(page.getByText(MARKER_A_NAME)).toBeVisible();
    await expect(page.getByText(MARKER_B_NAME)).toHaveCount(0);

    // Globale Team-Auswahl (persistiert unter "dienstplan.selectedTeamId";
    // der TeamSwitcher selbst wird auf /einstellungen nicht gerendert):
    // vor dem Umschalten steht sie NICHT auf Team B (null = Auto-Auswahl
    // des ersten Teams, also des Standard-Teams).
    const readGlobalTeam = () =>
      page.evaluate(() => localStorage.getItem("dienstplan.selectedTeamId"));
    const globalBefore = await readGlobalTeam();
    expect([null, String(standardTeamId)]).toContain(globalBefore);

    // Auf Team B umschalten -> Liste zeigt Marker B, Marker A verschwindet.
    await filter.click();
    await page
      .getByRole("option", { name: `E2E Dienste-Filter Team B ${h.run}` })
      .click();
    await expect(page.getByText(MARKER_B_NAME)).toBeVisible();
    await expect(page.getByText(MARKER_A_NAME)).toHaveCount(0);

    // Invariante: Das lokale Dienste-Dropdown übersteuert NUR diese Seite —
    // die persistierte GLOBALE Team-Auswahl bleibt unverändert (nicht Team B).
    expect(await readGlobalTeam()).toBe(globalBefore);

    // Neuanlage über den Dialog: Der globale Team-Switcher steht weiterhin auf
    // dem Standard-Team, nur das Dienste-Dropdown auf Team B — der neue Dienst
    // muss trotzdem in Team B landen.
    await page.getByRole("button", { name: /Neuen Dienst|^Neu$/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Neues Schichtmodell")).toBeVisible();
    await dialog.getByPlaceholder("z.B. Aktivdienst").fill(NEW_MODEL_NAME);
    await dialog.getByRole("button", { name: /Anlegen|Speichern|Erstellen/ }).click();
    await expect(dialog).toHaveCount(0);

    // Der neue Dienst erscheint in der (weiter auf Team B gefilterten) Liste.
    await expect(page.getByText(NEW_MODEL_NAME)).toBeVisible();

    // API-Nachweis: NUR in Team B, NICHT im Standard-Team.
    const inB = await listModels(teamB);
    expect(inB.map((m) => m.name)).toContain(NEW_MODEL_NAME);
    const inA = await listModels(standardTeamId);
    expect(inA.map((m) => m.name)).not.toContain(NEW_MODEL_NAME);
  });

  test("Privat-Konto: kein Team-Dropdown im Dienste-Bereich", async ({ page }) => {
    test.setTimeout(90_000);
    expect(privatAcc, "Voraussetzung: Privat-Konto registriert").toBeTruthy();

    await loginViaUi(page, privatAcc!.email, FREE_ACCOUNT_PASSWORD);
    await gotoEinstellungen(page);

    // Der Dienste-Bereich ist da (geseedete Standard-Dienste sichtbar) ...
    // Der Name kommt aus DEFAULT_SHIFT_MODELS, nicht abgeschrieben: Die
    // Seed-Liste hat sich schon einmal geaendert (von fuenf Diensten auf die
    // Teamsitzung), und ein festgetippter Name laesst diesen Test dann ins
    // Leere laufen — er prueft hier ja nur, DASS der Bereich befuellt ist.
    // Gesucht wird INNERHALB der Dienste-Liste: "Teamsitzung" steht auf der
    // Einstellungsseite auch am Schalter "Team-Dienst (Teamsitzung)", eine
    // seitenweite Textsuche traefe beide.
    const ersterStandardDienst = DEFAULT_SHIFT_MODELS[0]!.name;
    await expect(
      page.getByTestId("model-list").getByText(ersterStandardDienst, { exact: true }),
    ).toBeVisible();
    // ... aber ohne Team-Dropdown.
    await expect(page.getByTestId("model-team-filter")).toHaveCount(0);
  });
});
