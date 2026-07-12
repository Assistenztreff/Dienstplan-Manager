import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Gegenprobe zum Buchungspfad: das Entfernen eines Urlaubs-Eintrags muss den
 * genommenen Urlaub wieder zurückbuchen und den Resturlaub gutschreiben.
 *
 * Die bestehenden Tests sichern die Vorwärtsrichtung ab (Buchen zieht ab; Krank
 * verbraucht keinen Urlaub — Task #180/#193). Hier wird der umgekehrte Pfad
 * geprüft: Nach dem Löschen mehrerer Urlaubstage über die UI muss
 * vacation-taken wieder 0 und vacation-remaining wieder = entitlement sein —
 * eine Regression würde Assistenten dauerhaft Urlaubstage kosten, obwohl der
 * Eintrag entfernt wurde.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent MIT Vertrag (30 Urlaubstage)
 * - Urlaubs-Buchung über 3 zusammenhängende Tage im laufenden Jahr über die UI
 * - Zwischenstand: vacation-taken = 3, vacation-remaining = entitlement - 3
 * - Löschen des Urlaubs-Zeitraums über die UI (absence-delete)
 * - Danach: vacation-taken-<id> = 0, vacation-remaining-<id> = entitlement
 * - Backend-Gegenprobe: contract.vacationDaysUsed == 0
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport hält das Layout der Resturlaub-Karte stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Laufendes Jahr — die Resturlaub-Anzeige zählt ausschließlich Urlaubstage des
// aktuellen Jahres (currentYear in der Seite).
const YEAR = new Date().getFullYear();
const VACATION_DAYS = 30;
const CONTRACT_START = `${YEAR}-01-01`;

// 3 aufeinanderfolgende Urlaubs-Tage im laufenden Jahr (fern von Jahresgrenzen),
// damit sie zu einem einzigen Zeitraum (= ein Lösch-Button) zusammengefasst werden.
const VACATION_FROM = `${YEAR}-06-20`;
const VACATION_TO = `${YEAR}-06-22`;
const EXPECTED_VACATION_DAYS = 3;

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number; userId: number; vacationDays: number; vacationHoursUsed: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E UrlaubLoeschen ${suffix}`,
      email: `e2e.urlaubloeschen.${suffix}@dienstplan.test`,
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

async function bookAbsence(
  page: Page,
  name: string,
  kind: "Urlaub" | "Krank",
  fromDate: string,
  toDate: string
): Promise<void> {
  await page.getByTestId("absence-user").click();
  await page.getByRole("option", { name }).click();

  await page.getByTestId("absence-type").click();
  await page.getByRole("option", { name: kind, exact: true }).click();

  await page.getByTestId("absence-from").fill(fromDate);
  await page.getByTestId("absence-to").fill(toDate);
  await page.getByTestId("absence-save").click();
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
  // Aufräumen: etwaige verbliebene Urlaubsschichten, dann Vertrag und Nutzer.
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

test("Entfernen eines Urlaubs-Zeitraums bucht den Resturlaub wieder gut", async ({ page }) => {
  // Mehrstufiger UI-Flow (Anlegen + Loeschen + Neuladen) — unter Volllast der
  // Gesamtsuite reichen die 30s-Defaults nicht zuverlaessig.
  test.setTimeout(60000);
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/abwesenheiten");
  await expect(page.getByRole("heading", { name: "Abwesenheiten", exact: true })).toBeVisible();

  const remaining = page.getByTestId(`vacation-remaining-${assistant.id}`);
  const entitlement = page.getByTestId(`vacation-entitlement-${assistant.id}`);
  const taken = page.getByTestId(`vacation-taken-${assistant.id}`);

  // Ausgangszustand: voller Anspruch, nichts genommen.
  await expect(entitlement).toHaveText(String(VACATION_DAYS));
  await expect(taken).toHaveText("0");
  await expect(remaining).toHaveText(String(VACATION_DAYS));

  // 1) Urlaub buchen (3 zusammenhängende Tage).
  await bookAbsence(page, assistant.name, "Urlaub", VACATION_FROM, VACATION_TO);
  await expect(page.getByTestId("absence-list")).toContainText("Urlaub");

  // Zwischenstand: genommener Urlaub und Resturlaub spiegeln die Buchung.
  await expect(taken).toHaveText(String(EXPECTED_VACATION_DAYS));
  await expect(remaining).toHaveText(String(VACATION_DAYS - EXPECTED_VACATION_DAYS));

  // Backend-Zwischenprobe: vacationDaysUsed des Vertrags wurde hochgezählt.
  const midRes = await adminCtx.get(`/api/contracts?userId=${assistant.id}`);
  expect(midRes.ok(), "GET /api/contracts (Zwischenstand) fehlgeschlagen").toBe(true);
  const midContract = ((await midRes.json()) as Contract[]).find((c) => c.id === contractId);
  expect(midContract, "Vertrag nicht gefunden").toBeTruthy();
  // Stundengenaue Buchung: Tage = vacationHoursUsed / 8 (vacationHoursPerDay).
  expect(midContract!.vacationHoursUsed / 8).toBe(EXPECTED_VACATION_DAYS);

  // 2) Den Urlaubs-Zeitraum dieses Assistenten über die UI löschen. Die Liste
  // zeigt Zeiträume aller Assistenten — gezielt die Zeile dieses Assistenten
  // greifen, damit fremde Einträge unberührt bleiben.
  const absenceRow = page
    .getByTestId("absence-list")
    .locator("> div")
    .filter({ hasText: assistant.name });
  await expect(absenceRow).toHaveCount(1);
  await absenceRow.getByTestId("absence-delete").click();

  // Nach dem Löschen: der Eintrag verschwindet aus der Liste.
  await expect(absenceRow).toHaveCount(0);

  // Resturlaub-Gutschrift: genommener Urlaub zurück auf 0, voller Resturlaub.
  await expect(taken).toHaveText("0");
  await expect(remaining).toHaveText(String(VACATION_DAYS));

  // Backend-Gegenprobe: vacationDaysUsed des Vertrags wurde zurückgebucht.
  const afterRes = await adminCtx.get(`/api/contracts?userId=${assistant.id}`);
  expect(afterRes.ok(), "GET /api/contracts (nach Löschen) fehlgeschlagen").toBe(true);
  const afterContract = ((await afterRes.json()) as Contract[]).find((c) => c.id === contractId);
  expect(afterContract, "Vertrag nicht gefunden").toBeTruthy();
  expect(afterContract!.vacationHoursUsed / 8).toBe(0);
});
