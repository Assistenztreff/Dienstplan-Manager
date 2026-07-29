import { pickDateField } from "./helpers/date-picker";
import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test für den Abwesenheitsplaner (Urlaub) an der Jahres-/Vertragsgrenze.
 *
 * Sichert ab, dass eine Urlaubsbuchung exakt am 1. Januar (zugleich
 * Vertragsbeginn) korrekt vom Resturlaub abgezogen wird — sowohl in der
 * sichtbaren Resturlaub-Anzeige als auch im serverseitig fortgeschriebenen
 * `vacationDaysUsed` des für dieses Datum gültigen Vertrags.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent + Vertrag (Beginn 1.1. des laufenden Jahres, 30 Urlaubstage)
 * - Urlaubsbuchung am Vertragsbeginn/Jahresanfang über die UI
 * - Resturlaub-Anzeige zeigt 29 von 30 (1 genommen)
 * - Backend: vacationDaysUsed des Vertrags wird auf 1 gebucht
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: die Resturlaub-Karte und das Erfassungsformular sind in
// beiden Viewports sichtbar; Desktop hält das Layout stabil.
test.use({ viewport: { width: 1280, height: 800 } });

const VACATION_DAYS = 30;
// Laufendes Jahr — die Resturlaub-Anzeige zählt ausschließlich Urlaubstage des
// aktuellen Jahres (currentYear in der Seite).
const YEAR = new Date().getFullYear();
const CONTRACT_START = `${YEAR}-01-01`;
// Buchung exakt am Jahresanfang = Vertragsbeginn (die zu prüfende Grenze).
const VACATION_DAY = `${YEAR}-01-01`;

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number; userId: number; vacationDays: number; vacationHoursUsed: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E Abwesenheit ${suffix}`,
      email: `e2e.abwesenheit.${suffix}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as CreatedUser;
}

async function createContract(ctx: APIRequestContext, userId: number): Promise<number> {
  const res = await ctx.post("/api/contracts", {
    data: {
      userId,
      startDate: CONTRACT_START,
      weeklyHours: 40,
      vacationDays: VACATION_DAYS,
    },
  });
  expect(res.ok(), `Anlegen des Vertrags fehlgeschlagen (${res.status()})`).toBe(true);
  const contract = (await res.json()) as Contract;
  return contract.id;
}

async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
  // der Vite-Dev-Auto-Login (der sonst als Seed-Admin anmeldet) greift nie —
  // der Test agiert garantiert als der gewünschte Nutzer (dev- UND prod-tauglich).
  const res = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(res.ok(), `Login als ${email} fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  assistant = await createAssistant(adminCtx, `${unique}`);
  contractId = await createContract(adminCtx, assistant.id);
});

test.afterAll(async () => {
  // Aufräumen: erst die Urlaubsschichten, dann Vertrag und Nutzer.
  const shiftRes = await adminCtx.get(`/api/shifts?type=vacation&userId=${assistant.id}`);
  if (shiftRes.ok()) {
    const shifts = (await shiftRes.json()) as { id: number; userId: number }[];
    for (const s of shifts.filter((s) => s.userId === assistant.id)) {
      await adminCtx.delete(`/api/shifts/${s.id}`);
    }
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistant?.id) await adminCtx.delete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test("Urlaubsbuchung am 1. Januar / Vertragsbeginn zieht korrekt vom Resturlaub ab", async ({
  page,
}) => {
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/abwesenheiten");
  await expect(page.getByRole("heading", { name: "Abwesenheiten", exact: true })).toBeVisible();

  // Vor der Buchung: voller Anspruch sichtbar (über stabile data-testids je userId).
  const remaining = page.getByTestId(`vacation-remaining-${assistant.id}`);
  const entitlement = page.getByTestId(`vacation-entitlement-${assistant.id}`);
  const taken = page.getByTestId(`vacation-taken-${assistant.id}`);
  await expect(entitlement).toHaveText(String(VACATION_DAYS));
  await expect(taken).toHaveText("0");
  await expect(remaining).toHaveText(String(VACATION_DAYS));

  // Assistent im Erfassungsformular auswählen.
  await page.getByTestId("absence-user").click();
  await page.getByRole("option", { name: assistant.name }).click();

  // Typ bleibt "Urlaub" (Default). Zeitraum = einzelner Tag am Vertragsbeginn.
  await pickDateField(page, "absence-from", VACATION_DAY);
  await pickDateField(page, "absence-to", VACATION_DAY);
  await page.getByTestId("absence-save").click();

  // Buchung erscheint in der Liste. Großzügiges Zeitfenster: der POST /shifts
  // (Urlaubsbuchung inkl. Vertrags-Update) kann unter Last mehrere Sekunden
  // dauern — die Default-5s liefen dabei nachweislich knapp ab (POST 201).
  await expect(page.getByTestId("absence-list")).toContainText("Urlaub", { timeout: 15000 });

  // Resturlaub-Anzeige aktualisiert: 29 von 30 (1 genommen).
  await expect(taken).toHaveText("1");
  await expect(remaining).toHaveText(String(VACATION_DAYS - 1));

  // Backend: vacationDaysUsed des für den 1.1. gültigen Vertrags ist auf 1 gebucht.
  const contractsRes = await adminCtx.get(`/api/contracts?userId=${assistant.id}`);
  expect(contractsRes.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await contractsRes.json()) as Contract[];
  const contract = contracts.find((c) => c.id === contractId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  // Stundengenaue Buchung: 1 ganztägiger Urlaubstag = 8h (Tage = Stunden / 8).
  expect(contract!.vacationHoursUsed / 8).toBe(1);
});
