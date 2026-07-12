import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Gegenprobe zum partiellen Löschen: hat ein Assistent MEHRERE getrennte
 * Urlaubs-Zeiträume und wird nur EINER davon gelöscht, darf NUR dieser Zeitraum
 * gutgeschrieben werden — der verbleibende Resturlaub muss exakt stimmen.
 *
 * Während die Schwester-Spec (…urlaub-loeschen-gutschrift) das Löschen eines
 * einzelnen, isolierten Zeitraums absichert (taken zurück auf 0), prüft diese
 * Spec den realistischeren Aufräum-Fall mit zwei getrennten Zeiträumen. Eine
 * Regression im Lösch-/Rückbuchungspfad (z.B. doppeltes Gutschreiben oder
 * Rückbuchung des falschen Zeitraums) würde contract.vacationDaysUsed über-
 * oder unterbuchen und Assistenten still zu viele/zu wenige Urlaubstage kosten.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent MIT Vertrag (30 Urlaubstage)
 * - Zwei GETRENNTE Urlaubs-Zeiträume im laufenden Jahr (2 Tage + 3 Tage mit Lücke)
 * - Zwischenstand: vacation-taken = 5, vacation-remaining = entitlement - 5
 * - Gezieltes Löschen NUR des 3-Tage-Zeitraums über die UI (Zeile per Name + Datum)
 * - Danach: vacation-taken = 2 (verbleibender Zeitraum), vacation-remaining = entitlement - 2
 * - Backend-Gegenprobe: contract.vacationDaysUsed == 2
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

// Zwei getrennte Urlaubs-Zeiträume im laufenden Jahr mit ausreichend Lücke,
// damit buildRanges sie als ZWEI separate Zeiträume (zwei Lösch-Buttons) führt.
// Behalten-Zeitraum: 2 Tage. Lösch-Zeitraum: 3 Tage.
const KEEP_FROM = `${YEAR}-06-10`;
const KEEP_TO = `${YEAR}-06-11`;
const KEEP_DAYS = 2;

const DELETE_FROM = `${YEAR}-06-20`;
const DELETE_TO = `${YEAR}-06-22`;
const DELETE_DAYS = 3;

const TOTAL_DAYS = KEEP_DAYS + DELETE_DAYS;

// Datumslabel des zu löschenden Zeitraums, wie es die Liste rendert (dd.MM.yyyy).
const DELETE_DATE_LABEL = "20.06.";

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number; userId: number; vacationDays: number; vacationHoursUsed: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E UrlaubTeilLoeschen ${suffix}`,
      email: `e2e.urlaubteilloeschen.${suffix}@dienstplan.test`,
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

test("Löschen nur eines von zwei Urlaubs-Zeiträumen bucht exakt diesen gut", async ({ page }) => {
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

  // 1) Beide getrennten Urlaubs-Zeiträume buchen.
  await bookAbsence(page, assistant.name, "Urlaub", KEEP_FROM, KEEP_TO);
  await bookAbsence(page, assistant.name, "Urlaub", DELETE_FROM, DELETE_TO);

  // Beide Zeiträume erscheinen als getrennte Zeilen dieses Assistenten.
  const assistantRows = page
    .getByTestId("absence-list")
    .locator("> div")
    .filter({ hasText: assistant.name });
  await expect(assistantRows).toHaveCount(2);

  // Zwischenstand: beide Zeiträume zusammen abgezogen.
  await expect(taken).toHaveText(String(TOTAL_DAYS));
  await expect(remaining).toHaveText(String(VACATION_DAYS - TOTAL_DAYS));

  // Backend-Zwischenprobe: vacationDaysUsed entspricht der Summe beider Zeiträume.
  const midRes = await adminCtx.get(`/api/contracts?userId=${assistant.id}`);
  expect(midRes.ok(), "GET /api/contracts (Zwischenstand) fehlgeschlagen").toBe(true);
  const midContract = ((await midRes.json()) as Contract[]).find((c) => c.id === contractId);
  expect(midContract, "Vertrag nicht gefunden").toBeTruthy();
  // Stundengenaue Buchung: Tage = vacationHoursUsed / 8 (vacationHoursPerDay).
  expect(midContract!.vacationHoursUsed / 8).toBe(TOTAL_DAYS);

  // 2) Gezielt NUR den 3-Tage-Zeitraum löschen: Zeile per Assistentenname UND
  // Startdatum filtern, damit der zu behaltende Zeitraum unberührt bleibt.
  const deleteRow = page
    .getByTestId("absence-list")
    .locator("> div")
    .filter({ hasText: assistant.name })
    .filter({ hasText: DELETE_DATE_LABEL });
  await expect(deleteRow).toHaveCount(1);
  await deleteRow.getByTestId("absence-delete").click();

  // Nach dem Löschen: nur noch der behaltene Zeitraum verbleibt.
  await expect(assistantRows).toHaveCount(1);
  await expect(deleteRow).toHaveCount(0);

  // Teilweise Gutschrift: NUR der gelöschte Zeitraum (3 Tage) zurückgebucht,
  // der verbleibende 2-Tage-Zeitraum bleibt abgezogen.
  await expect(taken).toHaveText(String(KEEP_DAYS));
  await expect(remaining).toHaveText(String(VACATION_DAYS - KEEP_DAYS));

  // Backend-Gegenprobe: vacationDaysUsed == verbleibende Tage (kein Über-/Unterbuchen).
  const afterRes = await adminCtx.get(`/api/contracts?userId=${assistant.id}`);
  expect(afterRes.ok(), "GET /api/contracts (nach Löschen) fehlgeschlagen").toBe(true);
  const afterContract = ((await afterRes.json()) as Contract[]).find((c) => c.id === contractId);
  expect(afterContract, "Vertrag nicht gefunden").toBeTruthy();
  expect(afterContract!.vacationHoursUsed / 8).toBe(KEEP_DAYS);
});
