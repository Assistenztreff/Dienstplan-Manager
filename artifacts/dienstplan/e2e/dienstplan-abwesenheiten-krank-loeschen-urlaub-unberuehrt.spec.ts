import { pickDateField } from "./helpers/date-picker";
import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Gegenprobe zum Lösch-/Rückbuchungspfad: hat ein Assistent parallel einen
 * Urlaubs- UND einen Krank-Zeitraum und wird NUR der Krank-Zeitraum gelöscht,
 * darf der genommene Urlaub (vacation-taken / vacation-remaining /
 * contract.vacationDaysUsed) NICHT verändert werden — Krank verbraucht keinen
 * Urlaub, das Aufräumen eines Krank-Eintrags darf daher auch nichts gutschreiben.
 *
 * Während die Schwester-Specs (…urlaub-loeschen-gutschrift / …teilweise) das
 * korrekte ZURÜCKBUCHEN beim Löschen von Urlaub absichern, prüft diese Spec, dass
 * der DELETE-Handler beim Typ "sick" gar nicht erst in den Rückbuchungs-Branch
 * läuft. Eine Regression (z.B. adjustVacationDaysUsed liefe versehentlich auch
 * für type=sick) würde Assistenten beim Aufräumen von Krank-Einträgen still
 * Urlaubstage gutschreiben.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent MIT Vertrag (30 Urlaubstage)
 * - Parallel ein Urlaubs- (2 Tage) und ein Krank-Zeitraum (3 Tage) im laufenden Jahr
 * - Zwischenstand: vacation-taken = 2 (nur Urlaub), contract.vacationDaysUsed = 2
 * - Gezieltes Löschen NUR des Krank-Zeitraums über die UI (Zeile per Name + "Krank")
 * - Danach: vacation-taken / vacation-remaining unverändert; contract.vacationDaysUsed == 2
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

// Urlaubs-Zeitraum (bleibt erhalten): 2 Tage.
const VACATION_FROM = `${YEAR}-06-10`;
const VACATION_TO = `${YEAR}-06-11`;
const VACATION_TAKEN = 2;

// Krank-Zeitraum (wird gelöscht): 3 Tage, ohne Überschneidung mit dem Urlaub.
const SICK_FROM = `${YEAR}-06-20`;
const SICK_TO = `${YEAR}-06-22`;

// Datumslabel des zu löschenden Krank-Zeitraums, wie es die Liste rendert
// (dd.MM.yyyy). Eindeutig gegenüber dem Urlaubs-Zeitraum (10.06.).
const SICK_DATE_LABEL = "20.06.";

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number; userId: number; vacationDays: number; vacationHoursUsed: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E KrankLoeschen ${suffix}`,
      email: `e2e.krankloeschen.${suffix}@dienstplan.test`,
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

  await pickDateField(page, "absence-from", fromDate);
  await pickDateField(page, "absence-to", toDate);
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
  // Aufräumen: etwaige verbliebene Urlaubs-/Krank-Schichten, dann Vertrag und Nutzer.
  for (const type of ["vacation", "sick"]) {
    const shiftRes = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistant.id}`);
    if (shiftRes.ok()) {
      const shifts = (await shiftRes.json()) as { id: number; userId: number }[];
      for (const s of shifts.filter((s) => s.userId === assistant.id)) {
        await adminCtx.delete(`/api/shifts/${s.id}`);
      }
    }
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistant?.id) await adminCtx.delete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test("Löschen eines Krank-Zeitraums lässt den genommenen Urlaub unberührt", async ({ page }) => {
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

  // 1) Beide Zeiträume buchen: Urlaub (2 Tage) und Krank (3 Tage).
  await bookAbsence(page, assistant.name, "Urlaub", VACATION_FROM, VACATION_TO);
  await bookAbsence(page, assistant.name, "Krank", SICK_FROM, SICK_TO);

  // Beide Zeiträume erscheinen als getrennte Zeilen dieses Assistenten.
  const assistantRows = page
    .getByTestId("absence-list")
    .locator("> div")
    .filter({ hasText: assistant.name });
  await expect(assistantRows).toHaveCount(2);

  // Zwischenstand: NUR der Urlaub zählt (2 genommen); die Krank-Tage ändern den
  // Resturlaub nicht (sonst stünden hier 5 genommen bzw. 25 Resturlaub).
  await expect(taken).toHaveText(String(VACATION_TAKEN));
  await expect(remaining).toHaveText(String(VACATION_DAYS - VACATION_TAKEN));

  // Backend-Zwischenprobe: vacationDaysUsed zählt ausschließlich die Urlaubstage.
  const midRes = await adminCtx.get(`/api/contracts?userId=${assistant.id}`);
  expect(midRes.ok(), "GET /api/contracts (Zwischenstand) fehlgeschlagen").toBe(true);
  const midContract = ((await midRes.json()) as Contract[]).find((c) => c.id === contractId);
  expect(midContract, "Vertrag nicht gefunden").toBeTruthy();
  // Stundengenaue Buchung: Tage = vacationHoursUsed / 8 (vacationHoursPerDay).
  expect(midContract!.vacationHoursUsed / 8).toBe(VACATION_TAKEN);

  // 2) Gezielt NUR den Krank-Zeitraum löschen: Zeile per Assistentenname UND
  // Startdatum filtern, damit der Urlaubs-Zeitraum unberührt bleibt.
  const sickRow = page
    .getByTestId("absence-list")
    .locator("> div")
    .filter({ hasText: assistant.name })
    .filter({ hasText: SICK_DATE_LABEL });
  await expect(sickRow).toHaveCount(1);
  await sickRow.getByTestId("absence-delete").click();

  // Nach dem Löschen: nur noch der Urlaubs-Zeitraum verbleibt, kein Krank mehr.
  await expect(assistantRows).toHaveCount(1);
  await expect(sickRow).toHaveCount(0);

  // Kernaussage: der genommene Urlaub bleibt UNVERÄNDERT — das Löschen des
  // Krank-Zeitraums hat NICHTS gutgeschrieben.
  await expect(taken).toHaveText(String(VACATION_TAKEN));
  await expect(remaining).toHaveText(String(VACATION_DAYS - VACATION_TAKEN));

  // Backend-Gegenprobe: vacationDaysUsed unverändert (kein versehentliches
  // Gutschreiben für type=sick).
  const afterRes = await adminCtx.get(`/api/contracts?userId=${assistant.id}`);
  expect(afterRes.ok(), "GET /api/contracts (nach Löschen) fehlgeschlagen").toBe(true);
  const afterContract = ((await afterRes.json()) as Contract[]).find((c) => c.id === contractId);
  expect(afterContract, "Vertrag nicht gefunden").toBeTruthy();
  expect(afterContract!.vacationHoursUsed / 8).toBe(VACATION_TAKEN);
});
