import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  BASE_URL,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Test: Der Zugriffsrechte-Dialog in der Team-Verwaltung fuer Teamleiter.
 *
 * Ein Teamleiter (ohne Admin-Rolle) sieht in seinem Team den
 * Zugriffsrechte-Knopf und kann im Dialog Zugriffsstufen vergeben. Die
 * Inhaber-only-Bedienelemente (Teamleiter-Schalter, Lohndaten-Freigabe)
 * erscheinen fuer ihn nicht, und die Zeile des Konto-Inhabers ist
 * schreibgeschuetzt.
 */

const RUN = Date.now();
const LEITER_EMAIL = `e2e.tlui.leiter.${RUN}@dienstplan.test`;
const LEITER_PASSWORD = `Pw${RUN}!tlui`;

type Entity = { id: number };
type Team = { id: number };

let owner: FreeAccount;
let teamA = 0;
let leiterId = 0;
let kollegeId = 0;

test.beforeAll(async () => {
  owner = await registerFreeAccount("dienstleister", `tlui${RUN}`);
  // Premium: Einladungs-Logins sind ein Premium-Feature.
  await setAccountPlan(owner.email, "premium");

  const teamsRes = await owner.ctx.get("/api/teams");
  expect(teamsRes.ok(), "Teams lesen fehlgeschlagen").toBe(true);
  teamA = ((await teamsRes.json()) as Team[])[0]!.id;

  const leiterRes = await owner.ctx.post("/api/users", {
    data: { name: `E2E TL-UI Leiter ${RUN}`, email: LEITER_EMAIL, role: "assistant", teamId: teamA },
  });
  expect(leiterRes.ok(), "Leiter anlegen fehlgeschlagen").toBe(true);
  leiterId = ((await leiterRes.json()) as Entity).id;

  const kollegeRes = await owner.ctx.post("/api/users", {
    data: {
      name: `E2E TL-UI Kollege ${RUN}`,
      email: `e2e.tlui.kollege.${RUN}@dienstplan.test`,
      role: "assistant",
      teamId: teamA,
    },
  });
  expect(kollegeRes.ok(), "Kollege anlegen fehlgeschlagen").toBe(true);
  kollegeId = ((await kollegeRes.json()) as Entity).id;

  const tlRes = await owner.ctx.patch(`/api/teams/${teamA}/members/${leiterId}`, {
    data: { isTeamleiter: true },
  });
  expect(tlRes.ok(), `Teamleiter einsetzen fehlgeschlagen (${tlRes.status()})`).toBe(true);

  // Passwort ueber den Einladungs-Token setzen, damit der Browser-Login klappt.
  const inviteRes = await owner.ctx.post(`/api/users/${leiterId}/invite`, {});
  expect(inviteRes.ok(), `Einladung fehlgeschlagen (${inviteRes.status()})`).toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };
  const pwCtx: APIRequestContext = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const pwRes = await pwCtx.post("/api/auth/set-password", {
    data: { token, password: LEITER_PASSWORD },
  });
  expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);
  await pwCtx.dispose();
});

test.afterAll(async () => {
  await deleteFreeAccount(owner);
});

/**
 * Programmatische Anmeldung ueber die API: page.request teilt den Cookie-Jar
 * mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
 * der Vite-Dev-Auto-Login greift nie.
 */
async function loginAsLeiter(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: LEITER_EMAIL, password: LEITER_PASSWORD },
  });
  expect(res.ok(), `Login als ${LEITER_EMAIL} fehlgeschlagen (${res.status()})`).toBe(true);
}

test("Teamleiter oeffnet den Zugriffsrechte-Dialog und vergibt eine Stufe", async ({ page }) => {
  await loginAsLeiter(page);
  await page.goto("/team-verwaltung");

  // Der Zugriffsrechte-Knopf erscheint fuer den Teamleiter in seinem Team.
  const rechteButton = page.getByTestId(`rights-team-${teamA}`);
  await expect(rechteButton).toBeVisible();
  await rechteButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Teamleiter-Sicht: Hinweis sichtbar, keine Inhaber-only-Schalter.
  await expect(dialog.getByText("kann nur der Konto-Inhaber")).toBeVisible();
  await expect(dialog.locator('[data-testid^="toggle-teamleiter-"]')).toHaveCount(0);

  // Die Zeile des Konto-Inhabers ist schreibgeschuetzt (kein Stufen-Select).
  await expect(dialog.getByTestId(`access-level-${owner.id}`)).toHaveCount(0);
  await expect(
    dialog.getByText("Konto-Inhaber — die Rechte kannst du hier nicht ändern."),
  ).toBeVisible();

  // Stufenvergabe fuer den Kollegen funktioniert.
  const select = dialog.getByTestId(`access-level-${kollegeId}`);
  await expect(select).toBeVisible();
  await select.click();
  await page.getByRole("option", { name: "Basis – nur ansehen" }).click();
  await expect(select).toContainText("Basis");

  // Gegenprobe ueber die API: Die Stufe wurde wirklich gespeichert.
  await expect
    .poll(async () => {
      const membersRes = await owner.ctx.get(`/api/teams/${teamA}/members`);
      const members = (await membersRes.json()) as { userId: number; accessLevel: string }[];
      return members.find((m) => m.userId === kollegeId)?.accessLevel;
    })
    .toBe("basis");
});
