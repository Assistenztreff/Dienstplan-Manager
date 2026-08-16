import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Smoke-Test (Aufgabe #828): Schnell-Krankmeldung aus der App.
 *
 * Prüft den kompletten Weg über die echte Oberfläche statt nur die API:
 * - Der auffällige "Krank melden"-Button erscheint auf dem Dashboard einer
 *   Assistenzkraft (KrankmeldungSection, ausgeblendet für Admins).
 * - Der Dialog zeigt die 4 Dauer-Karten, Standardauswahl "Heute".
 * - Nach "Weiter" erscheint der Bestätigungsschritt mit den betroffenen
 *   Tagen; "Krankmeldung absenden" trägt den Tag ein.
 * - Der Button verschwindet danach vom Dashboard (bereits heute krank,
 *   KrankmeldungSection liefert null) — das eigentliche Verhaltens-Kriterium
 *   der Aufgabe ("Button ausgeblendet, wenn bereits krank gemeldet").
 * - Der gleichwertige Kurzweg unter /abwesenheiten ist ebenfalls sichtbar.
 *
 * Aufbau wie die übrigen Assistenten-UI-Specs: Premium-Arbeitgeber, Assistent
 * per Einladungsflow eingeloggt, Session-Cookies in den Browser-Kontext
 * übernommen (verhindert das Dev-Auto-Login, Memory e2e-dev-auto-login).
 */

let admin: FreeAccount;
let assistantCtx: APIRequestContext | undefined;
let assistantId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "krankui");
  await setAccountPlan(admin.email, "premium"); // Einladen ist Premium-gegated.

  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const userRes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E KrankUI Assistent ${unique}`,
      email: `e2e.krankui.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  const inviteRes = await admin.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.ok(), `Einladung sollte klappen (${inviteRes.status()})`).toBe(true);
  const inviteToken = ((await inviteRes.json()) as { token: string }).token;

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token: inviteToken, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
});

test.afterAll(async () => {
  await deleteFreeAccount(admin);
  try {
    await assistantCtx?.dispose();
  } catch {
    /* ignore */
  }
});

async function adoptAssistant(page: Page): Promise<void> {
  const state = await assistantCtx!.storageState();
  await page.context().addCookies(state.cookies);
}

test("Assistent kann sich über das Dashboard krank melden; Button verschwindet danach", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await adoptAssistant(page);
  await page.goto("/");

  const krankButton = page.getByTestId("krank-melden-btn");
  await expect(krankButton).toBeVisible({ timeout: 20_000 });
  await krankButton.click();

  // Schritt 1: Dauer-Auswahl — 4 Karten, Standard "Heute" bereits markiert.
  await expect(page.getByRole("dialog", { name: "Krank melden" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Heute/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Morgen/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mehrere Tage/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Bis Datum/ })).toBeVisible();

  await page.getByRole("button", { name: "Weiter" }).click();

  // Schritt 2: Bestätigung.
  await expect(page.getByText("1 Krankheitstag wird eingetragen.")).toBeVisible();
  await page.getByTestId("krankmeldung-absenden").click();

  // Erfolg: Dialog schließt, Toast erscheint.
  await expect(page.getByRole("dialog", { name: "Krank melden" })).toBeHidden({
    timeout: 10_000,
  });
  await expect(page.getByText("Krankmeldung für heute eingetragen.")).toBeVisible({
    timeout: 10_000,
  });

  // Kern-Kriterium: bereits heute krank -> Button verschwindet vom Dashboard.
  await page.reload();
  await expect(page.getByTestId("krank-melden-btn")).toHaveCount(0, { timeout: 20_000 });
});

test("Kurzweg unter /abwesenheiten ist für Assistenzkräfte ebenfalls vorhanden", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await adoptAssistant(page);
  await page.goto("/abwesenheiten");

  // Assistent war im vorigen Test bereits heute krank gemeldet — der Button
  // ist hier bewusst NICHT ausgeblendet (anders als das Dashboard: die Seite
  // erlaubt weitere/andere Zeiträume), er muss also sichtbar bleiben.
  await expect(page.getByTestId("abwesenheiten-krank-melden-btn")).toBeVisible({
    timeout: 20_000,
  });
});
