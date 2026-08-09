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
