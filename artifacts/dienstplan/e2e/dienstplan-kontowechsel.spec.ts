import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  BASE_URL,
  type FreeAccount,
} from "./helpers/teams";

/**
 * Kontowechsel im Browser abfangen (Task #742).
 *
 * Feldtest-Szenario: Der Inhaber legt eine Teamkoordinatorin an, öffnet ihren
 * Einladungslink im SELBEN Browser (ersetzt damit unbemerkt die eigene
 * Session) und versucht danach in der noch offenen Team-Verwaltung ein Team
 * zuzuweisen — das scheiterte bisher mit einem unverständlichen 403, während
 * die veraltete Inhaber-Ansicht stehen blieb.
 *
 * Erwartung jetzt:
 * 1. Der Team-Schalter zeigt eine klare Meldung ("als Inhaber anmelden").
 * 2. Die App erkennt den Kontowechsel (403 → /auth/me-Frischeprüfung),
 *    verwirft den Cache und verlässt die veraltete Inhaber-Ansicht.
 */

const RUN = Date.now();
const KOORD_EMAIL = `e2e.kwechsel.koord.${RUN}@dienstplan.test`;
const KOORD_PASSWORD = "koord12345";

type Team = { id: number };
type KoordinatorDto = { id: number; email: string };

let owner: FreeAccount;
let koordCtx: APIRequestContext | undefined;
let teamA = 0;
let koordId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  owner = await registerFreeAccount("dienstleister", `kwechsel${RUN}`);
  await setAccountPlan(owner.email, "premium");

  const teamsRes = await owner.ctx.get("/api/teams");
  expect(teamsRes.ok(), "Teams lesen fehlgeschlagen").toBe(true);
  teamA = ((await teamsRes.json()) as Team[])[0]!.id;

  // Koordinatorin anlegen und ihr per Einladung einen eigenen Login geben —
  // das Passwort-Setzen läuft in einem SEPARATEN Request-Kontext, damit die
  // Browser-Session des Tests davon unberührt bleibt.
  const createRes = await owner.ctx.post("/api/koordinatoren", {
    data: { name: `E2E Kontowechsel Koordinatorin ${RUN}`, email: KOORD_EMAIL },
  });
  expect(createRes.ok(), `Koordinatorin anlegen fehlgeschlagen (${createRes.status()})`).toBe(true);
  koordId = ((await createRes.json()) as KoordinatorDto).id;

  const inviteRes = await owner.ctx.post(`/api/users/${koordId}/invite`, {});
  expect(inviteRes.ok(), `Einladung fehlgeschlagen (${inviteRes.status()})`).toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };

  koordCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const pwRes = await koordCtx.post("/api/auth/set-password", {
    data: { token, password: KOORD_PASSWORD },
  });
  expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);
});

test.afterAll(async () => {
  await koordCtx?.dispose();
  await deleteFreeAccount(owner);
});

/** Programmatischer Login (teilt den Cookie-Jar der Seite, kein Dev-Auto-Login). */
async function loginAs(page: Page, email: string, password: string): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(res.ok(), `Login als ${email} fehlgeschlagen (${res.status()})`).toBe(true);
}

test("Nach Kontowechsel im selben Browser: klare Meldung statt veralteter Inhaber-Ansicht", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginAs(page, owner.email, FREE_ACCOUNT_PASSWORD);
  await page.goto("/team-verwaltung");

  const bereich = page.getByTestId("koordinatoren-bereich");
  await expect(bereich).toBeVisible();
  const schalter = page.getByTestId(`koordinator-team-${koordId}-${teamA}`);
  await expect(schalter).toBeVisible();

  // Kontowechsel hinter dem Rücken des Tabs: page.request teilt den
  // Cookie-Jar — exakt wie ein im selben Browser geöffneter Einladungslink.
  await loginAs(page, KOORD_EMAIL, KOORD_PASSWORD);

  // Die veraltete Inhaber-Ansicht steht noch — Team-Zuweisung anklicken.
  await schalter.click();

  // 1. Verständliche Fehlermeldung statt rohem "Keine Berechtigung".
  await expect(
    page.getByText("Inhaber des Dienstleister-Kontos", { exact: false }).first(),
  ).toBeVisible();

  // 2. Kontowechsel-Erkennung: Cache wird verworfen, die App meldet den
  //    Wechsel und verlässt die veraltete Inhaber-Ansicht.
  await expect(page.getByText("Anmeldung gewechselt", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await expect(bereich).not.toBeVisible({ timeout: 15_000 });
});
