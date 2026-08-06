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
 * UI-Test (Task #512): Assistenten sehen in der Resturlaub-Karte des
 * Dashboards die Transparenz-Zeile zur Urlaubstag-Bewertung
 * (data-testid `assistant-vacation-daily-hours`, eingefuehrt in #498):
 * "1 Urlaubstag = X h (Vertragsdaten|13-Wochen-Schnitt)".
 *
 * Die API-Seite (dailyHours/dailyHoursSource in GET
 * /contracts/:id/vacation-balance) ist bereits durch
 * dienstplan-vacation-balance-vertragsdaten-quelle-api.spec.ts abgesichert —
 * hier geht es um die tatsaechliche ANZEIGE in der Karte, damit ein Umbau der
 * Karte die Zeile nicht unbemerkt entfernt.
 *
 * Aufbau:
 * - Premium-Arbeitgeber (privat) via registerFreeAccount + setAccountPlan
 *   (vacation-balance ist absenceTracking-Premium, Gate ueber den
 *   Arbeitgeber-Plan; der Assistent selbst bleibt free).
 * - Assistent mit frischem Vertrag OHNE IST-Historie -> Quelle "contract"
 *   (Vertragsdaten), dailyHours = weeklyHours / workdaysPerWeek = 28/5 = 5,6.
 * - Login des Assistenten ueber den Einladungsflow (invite -> set-password),
 *   Session-Cookies werden in den Browser-Kontext uebernommen, damit das
 *   Dev-Auto-Login nicht dazwischenfunkt.
 *
 * Geprueft:
 * 1. Die Karte zeigt die Zeile "1 Urlaubstag = 5,6 h (Vertragsdaten)".
 * 2. Nach Korrektur auf DEZIMALE Arbeitstage/Woche (27,6 h ÷ 1,15 = exakt
 *    24 h, seit #706 moeglich) zeigt die Zeile "1 Urlaubstag = 24 h
 *    (Vertragsdaten)" — die Anzeige haengt live an der Bilanz, nicht an
 *    einem eingefrorenen Wert.
 */

let admin: FreeAccount;
let assistantCtx: APIRequestContext | undefined;
let assistantId = 0;
let contractId = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await registerFreeAccount("privat", "urlbew-ui");
  // Premium noetig fuer: Einladen (caregiverLogin) + vacation-balance
  // (absenceTracking, Gate ueber den Arbeitgeber-Plan).
  await setAccountPlan(admin.email, "premium");

  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const userRes = await admin.ctx.post("/api/users", {
    data: {
      name: `E2E UrlBew Assistent ${unique}`,
      email: `e2e.urlbew.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Frischer Vertrag ohne IST-Historie -> Bewertungsquelle "contract":
  // 28 h / 5 Arbeitstage = 5,6 h je Urlaubstag.
  const contractRes = await admin.ctx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: "2026-01-01",
      weeklyHours: 28,
      workdaysPerWeek: 5,
      vacationDays: 30,
    },
  });
  expect(contractRes.status(), "Vertrag anlegen sollte 201 liefern").toBe(201);
  contractId = ((await contractRes.json()) as { id: number }).id;

  // Assistent per Einladungsflow einloggen (set-password meldet direkt an).
  const inviteRes = await admin.ctx.post(`/api/users/${assistantId}/invite`);
  expect(inviteRes.ok(), `Einladung sollte klappen (${inviteRes.status()})`).toBe(true);
  const inviteToken = ((await inviteRes.json()) as { token: string }).token;
  expect(inviteToken, "Einladungs-Token muss geliefert werden").toBeTruthy();

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token: inviteToken, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
  const me = await assistantCtx.get("/api/auth/me");
  expect(me.ok(), "Assistent muss nach set-password eingeloggt sein").toBe(true);
  const meBody = (await me.json()) as { id: number; role: string };
  expect(meBody.id).toBe(assistantId);
  expect(meBody.role, "Session muss die Assistenten-Rolle tragen").toBe("assistant");
});

test.afterAll(async () => {
  // deleteFreeAccount entfernt Konto + Standard-Team + team-gebundene Daten
  // (inkl. Vertrag und verwaistem Assistenten).
  await deleteFreeAccount(admin);
  try {
    await assistantCtx?.dispose();
  } catch {
    /* ignore */
  }
});

/**
 * Uebernimmt die Session-Cookies des per Einladung eingeloggten Assistenten in
 * den Browser-Kontext, damit die App als DIESER Assistent bootstrappt und
 * NICHT das Dev-Auto-Login (Premium-Seed-Admin) ausloest.
 */
async function adoptAssistant(page: Page): Promise<void> {
  const state = await assistantCtx!.storageState();
  await page.context().addCookies(state.cookies);
}

test("Resturlaub-Karte zeigt die Urlaubstag-Bewertung mit Quelle Vertragsdaten", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await adoptAssistant(page);

  await page.goto("/");

  // Die Resturlaub-Karte muss erscheinen (Vertrag vorhanden, Premium-Gate
  // offen). Grosszuegiges Timeout: contracts + vacation-balance laufen
  // sequenziell gegen die entfernte DB (je 1-2 s Latenz) — 5 s Default reicht
  // dann nicht.
  await expect(page.getByTestId("assistant-vacation-card")).toBeVisible({ timeout: 20_000 });

  // Transparenz-Zeile: 28 h / 5 Tage = 5,6 h, Quelle Vertragsdaten
  // (formatHours nutzt de-DE, also Komma).
  const line = page.getByTestId("assistant-vacation-daily-hours");
  await expect(line).toBeVisible();
  await expect(
    line,
    "Zeile muss Wert UND Quelle anzeigen",
  ).toHaveText("1 Urlaubstag = 5,6 h (Vertragsdaten)");
});

test("Korrektur der Arbeitstage/Woche aendert die angezeigte Bewertung", async ({
  page,
}) => {
  test.setTimeout(60_000);

  // Dezimalwerte (seit #706): 27,6 h / 1,15 Arbeitstage = exakt 24 h je
  // Urlaubstag (24-h-Dienst-Szenario).
  const patch = await admin.ctx.patch(`/api/contracts/${contractId}`, {
    data: { workdaysPerWeek: 1.15, weeklyHours: 27.6 },
  });
  expect(patch.status(), "PATCH Dezimal-Arbeitstage sollte 200 liefern").toBe(200);

  await adoptAssistant(page);
  await page.goto("/");

  const line = page.getByTestId("assistant-vacation-daily-hours");
  // Siehe oben: sequenzielle Requests gegen die entfernte DB brauchen laenger.
  await expect(line).toBeVisible({ timeout: 20_000 });
  await expect(
    line,
    "Anzeige muss dem korrigierten Vertrag folgen",
  ).toHaveText("1 Urlaubstag = 24 h (Vertragsdaten)");
});
