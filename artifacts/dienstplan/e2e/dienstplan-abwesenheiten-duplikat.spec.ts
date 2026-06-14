import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test für den Schutz gegen doppelte Urlaubsabzüge im Abwesenheitsplaner.
 *
 * Beim erneuten Eintragen eines überlappenden Zeitraums überspringt die Seite
 * bewusst Tage, an denen für denselben Assistenten bereits eine Abwesenheit
 * desselben Typs existiert (`handleSave` -> `existingForUser`-Filter). Dieser
 * Test sichert ab, dass dadurch:
 * - nur die wirklich neuen Tage angelegt werden (Toast "N bereits vorhanden"),
 * - die Resturlaub-Anzeige nur um die neuen Tage sinkt,
 * - das serverseitige `vacationDaysUsed` NICHT doppelt hochgezählt wird.
 *
 * Ablauf:
 * - Erste Buchung: 10.+11. (2 Tage) -> Resturlaub 28, vacationDaysUsed 2
 * - Zweite, überlappende Buchung: 11.-13. -> 11. wird übersprungen, 12.+13. neu
 *   -> Resturlaub 26 (nur 2 neue Tage), vacationDaysUsed 4 (nicht 5)
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

test.use({ viewport: { width: 1280, height: 800 } });

const VACATION_DAYS = 30;
// Laufendes Jahr — die Resturlaub-Anzeige zählt ausschließlich Urlaubstage des
// aktuellen Jahres (currentYear in der Seite).
const YEAR = new Date().getFullYear();
const CONTRACT_START = `${YEAR}-01-01`;

// Erste Buchung: zwei Tage.
const FIRST_FROM = `${YEAR}-02-10`;
const FIRST_TO = `${YEAR}-02-11`;
// Zweite Buchung überlappt am 11. und ergänzt 12.+13.
const SECOND_FROM = `${YEAR}-02-11`;
const SECOND_TO = `${YEAR}-02-13`;

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number; userId: number; vacationDays: number; vacationDaysUsed: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E Duplikat ${suffix}`,
      email: `e2e.duplikat.${suffix}@dienstplan.test`,
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
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function vacationDaysUsed(ctx: APIRequestContext, userId: number, cId: number): Promise<number> {
  const res = await ctx.get(`/api/contracts?userId=${userId}`);
  expect(res.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await res.json()) as Contract[];
  const contract = contracts.find((c) => c.id === cId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  return contract!.vacationDaysUsed;
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

test("Überlappende Urlaubsbuchung überspringt bereits vorhandene Tage und zieht Resturlaub nicht doppelt ab", async ({
  page,
}) => {
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/abwesenheiten");
  await expect(page.getByRole("heading", { name: "Abwesenheiten", exact: true })).toBeVisible();

  const resturlaubRow = page
    .locator("div")
    .filter({ hasText: assistant.name })
    .filter({ hasText: "von 30 Tagen" })
    .last();
  await expect(resturlaubRow).toContainText("(0 genommen)");

  // Assistent auswählen (bleibt für beide Buchungen ausgewählt).
  await page.getByTestId("absence-user").click();
  await page.getByRole("option", { name: assistant.name }).click();

  // --- Erste Buchung: 10.+11. (2 Tage) ---
  await page.getByTestId("absence-from").fill(FIRST_FROM);
  await page.getByTestId("absence-to").fill(FIRST_TO);
  await page.getByTestId("absence-save").click();

  await expect(resturlaubRow).toContainText("(2 genommen)");
  await expect(resturlaubRow).toContainText("28");
  expect(await vacationDaysUsed(adminCtx, assistant.id, contractId)).toBe(2);

  // --- Zweite, überlappende Buchung: 11.-13. ---
  // Der 11. existiert bereits und muss übersprungen werden; nur 12.+13. neu.
  await page.getByTestId("absence-from").fill(SECOND_FROM);
  await page.getByTestId("absence-to").fill(SECOND_TO);
  await page.getByTestId("absence-save").click();

  // Toast bestätigt: 2 neue Tage angelegt, 1 bereits vorhanden.
  await expect(page.getByText(/2 Tage angelegt, 1 bereits vorhanden/)).toBeVisible();

  // Resturlaub sinkt nur um die 2 wirklich neuen Tage (auf 26), NICHT um 3.
  await expect(resturlaubRow).toContainText("(4 genommen)");
  await expect(resturlaubRow).toContainText("26");

  // Backend: insgesamt 4 eindeutige Urlaubstage (10.-13.), kein Doppelabzug.
  expect(await vacationDaysUsed(adminCtx, assistant.id, contractId)).toBe(4);
});
