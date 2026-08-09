import { test, expect, type Page } from "@playwright/test";
import {
  registerFreeAccount,
  deleteFreeAccount,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Test (#738): Der Teamleiter-Status wird ausschliesslich im
 * Zugriffsrechte-Dialog der Team-Verwaltung umgeschaltet — der fruehere
 * Karten-Button "Als Teamleiter einsetzen" existiert nicht mehr.
 *
 * Abgedeckt:
 * - Dienstleister-Inhaber: Schalter im Dialog setzt/entzieht den Status,
 *   Badge und Lohndaten-Freigabe reagieren live, Entzug raeumt die
 *   Lohndaten-Freigabe serverseitig mit ab.
 * - Privat-Inhaber: Schalter funktioniert genauso, aber ohne
 *   Lohndaten-Freigabe (die gibt es nur in Dienstleister-Konten).
 * - Die Assistenzkarte zeigt den Status nur noch als Badge an.
 */

const RUN = Date.now();

type Entity = { id: number };
type Team = { id: number };
type Member = { userId: number; isTeamleiter?: boolean; canViewPayroll?: boolean };

let dienst: FreeAccount;
let dienstTeamId = 0;
let dienstAssistentId = 0;

let privat: FreeAccount;
let privatTeamId = 0;
let privatAssistentId = 0;

async function createAssistant(acc: FreeAccount, name: string): Promise<number> {
  const res = await acc.ctx.post("/api/users", {
    data: {
      name,
      email: `e2e.tsd.${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.${RUN}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Assistenzkraft anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

async function firstTeamId(acc: FreeAccount): Promise<number> {
  const res = await acc.ctx.get("/api/teams");
  expect(res.ok(), `Teams lesen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Team[])[0]!.id;
}

async function readMember(acc: FreeAccount, teamId: number, userId: number): Promise<Member> {
  const res = await acc.ctx.get(`/api/teams/${teamId}/members`);
  expect(res.ok(), `Mitglieder lesen fehlgeschlagen (${res.status()})`).toBe(true);
  const member = ((await res.json()) as Member[]).find((m) => m.userId === userId);
  expect(member, "Mitglied nicht gefunden").toBeTruthy();
  return member!;
}

test.beforeAll(async () => {
  dienst = await registerFreeAccount("dienstleister", `tsdD${RUN}`);
  dienstTeamId = await firstTeamId(dienst);
  dienstAssistentId = await createAssistant(dienst, `TSD Dienst Kraft`);

  privat = await registerFreeAccount("privat", `tsdP${RUN}`);
  privatTeamId = await firstTeamId(privat);
  privatAssistentId = await createAssistant(privat, `TSD Privat Kraft`);
});

test.afterAll(async () => {
  await deleteFreeAccount(dienst);
  await deleteFreeAccount(privat);
});

/**
 * Programmatischer Login ueber die API: page.request teilt den Cookie-Jar mit
 * dem Browser, dadurch greift der Vite-Dev-Auto-Login nie.
 */
async function loginAs(page: Page, acc: FreeAccount): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: acc.email, password: FREE_ACCOUNT_PASSWORD },
  });
  expect(res.ok(), `Login als ${acc.email} fehlgeschlagen (${res.status()})`).toBe(true);
}

test("Dienstleister-Inhaber: Teamleiter-Schalter im Dialog inkl. Lohndaten-Kopplung", async ({
  page,
}) => {
  await loginAs(page, dienst);
  await page.goto("/team-verwaltung");

  // Der alte Karten-Button existiert nirgends mehr.
  await expect(page.getByText("Als Teamleiter einsetzen")).toHaveCount(0);

  await page.getByTestId(`rights-team-${dienstTeamId}`).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const schalter = dialog.getByTestId(`toggle-teamleiter-${dienstAssistentId}`);
  await expect(schalter).toBeVisible();
  // Hinweistext: Stufe-2-Gleichstellung + Dienstleister-Zusatz zur Lohndaten-Freigabe.
  await expect(dialog.getByText("zählt wie Stufe 2")).toBeVisible();
  await expect(
    dialog.getByText("Nur Teamleiter können die Lohndaten-Freigabe bekommen."),
  ).toBeVisible();

  // Vorher: kein Teamleiter, keine Lohndaten-Freigabe sichtbar.
  await expect(dialog.getByText("Darf Lohn- und Personaldaten sehen")).toHaveCount(0);

  // Einschalten: Toast, Badge im Dialog und Lohndaten-Schalter erscheinen live.
  await schalter.click();
  await expect(
    page.getByText("TSD Dienst Kraft ist jetzt Teamleiter.", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("Teamleiter", { exact: true })).toBeVisible();
  const lohnLabel = dialog.getByText("Darf Lohn- und Personaldaten sehen");
  await expect(lohnLabel).toBeVisible();
  await expect
    .poll(async () => (await readMember(dienst, dienstTeamId, dienstAssistentId)).isTeamleiter)
    .toBe(true);

  // Lohndaten-Freigabe direkt im Anschluss setzen.
  await dialog.locator(`#cp-${dienstAssistentId}`).click();
  await expect
    .poll(async () => (await readMember(dienst, dienstTeamId, dienstAssistentId)).canViewPayroll)
    .toBe(true);

  // Ausschalten: Lohndaten-Schalter verschwindet, Server raeumt die Freigabe mit ab.
  await schalter.click();
  await expect(
    page.getByText("TSD Dienst Kraft ist kein Teamleiter mehr.", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("Darf Lohn- und Personaldaten sehen")).toHaveCount(0);
  await expect
    .poll(async () => {
      const m = await readMember(dienst, dienstTeamId, dienstAssistentId);
      return `${m.isTeamleiter}/${m.canViewPayroll}`;
    })
    .toBe("false/false");
});

test("Privat-Inhaber: Teamleiter-Schalter ohne Lohndaten-Freigabe, Badge auf der Karte", async ({
  page,
}) => {
  await loginAs(page, privat);
  await page.goto("/team-verwaltung");

  await expect(page.getByText("Als Teamleiter einsetzen")).toHaveCount(0);

  await page.getByTestId(`rights-team-${privatTeamId}`).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const schalter = dialog.getByTestId(`toggle-teamleiter-${privatAssistentId}`);
  await expect(schalter).toBeVisible();
  // Privat-Konto: kein Lohndaten-Zusatz im Hinweistext.
  await expect(
    dialog.getByText("Nur Teamleiter können die Lohndaten-Freigabe bekommen."),
  ).toHaveCount(0);

  await schalter.click();
  await expect(
    page.getByText("TSD Privat Kraft ist jetzt Teamleiter.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await readMember(privat, privatTeamId, privatAssistentId)).isTeamleiter)
    .toBe(true);

  // Auch nach dem Einschalten bleibt die Lohndaten-Freigabe Privat-Konten verwehrt.
  await expect(dialog.getByText("Darf Lohn- und Personaldaten sehen")).toHaveCount(0);

  // Karte: Badge als reine Anzeige, ohne Umschalt-Button.
  await dialog.getByRole("button", { name: "Schließen" }).click();
  await expect(page.getByTestId(`teamleiter-badge-${privatAssistentId}`)).toBeVisible();
  await expect(page.getByText("Als Teamleiter einsetzen")).toHaveCount(0);
});
