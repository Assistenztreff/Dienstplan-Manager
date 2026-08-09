import { test, expect, type Page } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Test: Der Bereich "Teamkoordinatoren" in der Team-Verwaltung.
 *
 * Der Inhaber eines Premium-Dienstleister-Kontos legt dort einen Koordinator
 * an und weist ihm per Schalter ein Team zu. Gegenprobe ueber die API: Die
 * Zuweisung erzeugt wirklich eine Teamleiter-Mitgliedschaft.
 */

const RUN = Date.now();
const KOORD_EMAIL = `e2e.koordui.person.${RUN}@dienstplan.test`;

type Team = { id: number };

let owner: FreeAccount;
let teamA = 0;

test.beforeAll(async () => {
  owner = await registerFreeAccount("dienstleister", `koordui${RUN}`);
  // Premium: Koordinator anlegen ist Premium-gegated (eigener Login).
  await setAccountPlan(owner.email, "premium");

  const teamsRes = await owner.ctx.get("/api/teams");
  expect(teamsRes.ok(), "Teams lesen fehlgeschlagen").toBe(true);
  teamA = ((await teamsRes.json()) as Team[])[0]!.id;
});

test.afterAll(async () => {
  await deleteFreeAccount(owner);
});

/** Programmatischer Login (teilt den Cookie-Jar, Dev-Auto-Login greift nie). */
async function loginAsOwner(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: owner.email, password: FREE_ACCOUNT_PASSWORD },
  });
  expect(res.ok(), `Login als ${owner.email} fehlgeschlagen (${res.status()})`).toBe(true);
}

test("Inhaber legt einen Koordinator an und weist ihm ein Team zu", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/team-verwaltung");

  // Der Bereich existiert nur fuer Dienstleister-Inhaber.
  const bereich = page.getByTestId("koordinatoren-bereich");
  await expect(bereich).toBeVisible();
  await expect(bereich.getByText("Noch keine Teamkoordinatoren angelegt.")).toBeVisible();

  // Anlegen ueber den Dialog.
  await page.getByTestId("koordinator-anlegen").click();
  await page.getByTestId("koordinator-name").fill(`E2E Koordinatorin ${RUN}`);
  await page.getByTestId("koordinator-email").fill(KOORD_EMAIL);
  await page.getByTestId("koordinator-speichern").click();

  const card = bereich.locator('[data-testid^="koordinator-card-"]');
  await expect(card).toBeVisible();
  await expect(card.getByText("Noch kein Zugang")).toBeVisible();

  // Koordinator-ID fuer gezielte Selektoren aus der API holen.
  const listRes = await owner.ctx.get("/api/koordinatoren");
  expect(listRes.ok()).toBe(true);
  const koord = ((await listRes.json()) as { id: number; email: string }[]).find(
    (k) => k.email === KOORD_EMAIL,
  );
  expect(koord, "Koordinator nicht in der API-Liste").toBeTruthy();

  // Team per Schalter zuweisen.
  const schalter = page.getByTestId(`koordinator-team-${koord!.id}-${teamA}`);
  await expect(schalter).toBeVisible();
  await schalter.click();
  await expect(schalter).toBeChecked();

  // Gegenprobe API: Teamleiter-Mitgliedschaft existiert.
  await expect
    .poll(async () => {
      const membersRes = await owner.ctx.get(`/api/teams/${teamA}/members`);
      const members = (await membersRes.json()) as {
        userId: number;
        role: string;
        isTeamleiter: boolean;
      }[];
      const row = members.find((m) => m.userId === koord!.id);
      return row ? `${row.role}/${row.isTeamleiter}` : "fehlt";
    })
    .toBe("koordinator/true");

  // Einladen-Knopf oeffnet den Einladungs-Dialog (Link generierbar).
  await page.getByTestId(`koordinator-einladen-${koord!.id}`).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
});

/**
 * Koordinator-Sicht im Browser: Nach Einladung und Login sieht der
 * Koordinator nur sein zugewiesenes Team (Umschalter), hat dort den
 * Zugriffsrechte-Zugang eines Teamleiters, aber KEINE Koordinatoren-
 * Verwaltung und KEINE eigene Assistenzkraft-Karte.
 * Baut auf dem vorherigen Test auf (Koordinator existiert, Team A zugewiesen).
 */
test("Koordinator-Sicht: nur zugewiesenes Team, keine Verwaltung, keine Selbstkarte", async ({ page }) => {
  // Zweites, NICHT zugewiesenes Team anlegen (Gegenprobe im Umschalter).
  const teamBName = `Koord-Fremdteam ${RUN}`;
  const createRes = await owner.ctx.post("/api/teams", { data: { name: teamBName } });
  expect(createRes.ok(), `Team anlegen fehlgeschlagen (${createRes.status()})`).toBe(true);

  const teamsRes = await owner.ctx.get("/api/teams");
  const teamAName = ((await teamsRes.json()) as { id: number; name: string }[]).find(
    (t) => t.id === teamA,
  )!.name;

  // Koordinator-ID + Einladung -> Passwort setzen -> Browser-Login.
  const listRes = await owner.ctx.get("/api/koordinatoren");
  const koord = ((await listRes.json()) as { id: number; email: string }[]).find(
    (k) => k.email === KOORD_EMAIL,
  );
  expect(koord, "Koordinator aus Test 1 fehlt").toBeTruthy();

  const inviteRes = await owner.ctx.post(`/api/users/${koord!.id}/invite`, {});
  expect(inviteRes.ok(), `Einladung fehlgeschlagen (${inviteRes.status()})`).toBe(true);
  const { token, note } = (await inviteRes.json()) as { token: string; note: string };
  // Einladungstext spricht vom Teamkoordinator, nicht von der Assistenzkraft.
  expect(note).toContain("Teamkoordinators");

  const passwort = `KoordSicht!${RUN}`;
  const pwRes = await page.request.post("/api/auth/set-password", {
    data: { token, password: passwort },
  });
  expect(pwRes.ok(), `Passwort setzen fehlgeschlagen (${pwRes.status()})`).toBe(true);
  const loginRes = await page.request.post("/api/auth/login", {
    data: { email: KOORD_EMAIL, password: passwort },
  });
  expect(loginRes.ok(), `Koordinator-Login fehlgeschlagen (${loginRes.status()})`).toBe(true);

  await page.goto("/team-verwaltung");

  // Teamleiter-Zugang: Zugriffsrechte-Knopf des zugewiesenen Teams erscheint.
  // Grosszuegiger Timeout fuer den kalten Erst-Aufruf (Vite-Kompilierung).
  await expect(page.getByTestId(`rights-team-${teamA}`)).toBeVisible({ timeout: 20_000 });

  // Keine Koordinatoren-Verwaltung, keine eigene Assistenzkraft-Karte.
  await expect(page.getByTestId("koordinatoren-bereich")).toHaveCount(0);
  await expect(page.getByTestId(`assistant-card-${koord!.id}`)).toHaveCount(0);

  // Team-Umschalter (lebt in der Dienstplan-Kopfzeile, nicht auf
  // /team-verwaltung) bietet nur das zugewiesene Team an. Die Kopfzeile
  // rendert Mobile- und Desktop-Variante — nur die sichtbare anklicken.
  await page.goto("/dienstplan");
  const switcher = page.locator('button[aria-label="Team auswählen"]:visible');
  await expect(switcher).toBeVisible({ timeout: 20_000 });
  await switcher.click();
  await expect(page.getByRole("option", { name: teamAName })).toBeVisible();
  await expect(page.getByRole("option", { name: teamBName })).toHaveCount(0);
});
