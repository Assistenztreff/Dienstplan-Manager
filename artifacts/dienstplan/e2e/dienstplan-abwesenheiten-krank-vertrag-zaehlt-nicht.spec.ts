import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Gegenprobe zur Resturlaub-Karte bei einem Assistenten MIT aktivem Vertrag.
 *
 * Task #180 hat bereits abgesichert, dass Krank-Tage bei einem Assistenten OHNE
 * Vertrag nicht in den "N Tage geplant"-Zähler einfließen. Der häufigere
 * Praxisfall ist jedoch ein Assistent MIT Vertrag (vacationDays gesetzt): hier
 * zeigt die Karte "remaining von entitlement (taken genommen)". Krank-Tage
 * dürfen weder den genommenen Urlaub erhöhen noch den Resturlaub verringern —
 * sonst würde Krankheit den Assistenten fälschlich Urlaub kosten.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent MIT Vertrag (30 Urlaubstage)
 * - Krank-Buchung über 4 Tage im laufenden Jahr über die UI
 * - Nach reiner Krank-Buchung: taken bleibt 0, remaining bleibt = entitlement
 * - Zusätzliche Urlaubs-Buchung über 2 Tage im laufenden Jahr über die UI
 * - Danach: vacation-taken-<id> = 2 (nur Urlaub), vacation-remaining-<id> =
 *   entitlement - 2 (Krank-Tage ändern beides nicht)
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

// 4 aufeinanderfolgende Krank-Tage im laufenden Jahr (fern von Jahresgrenzen).
const SICK_FROM = `${YEAR}-06-10`;
const SICK_TO = `${YEAR}-06-13`;

// 2 aufeinanderfolgende Urlaubs-Tage im laufenden Jahr, ohne Überschneidung
// mit den Krank-Tagen.
const VACATION_FROM = `${YEAR}-06-20`;
const VACATION_TO = `${YEAR}-06-21`;
const EXPECTED_VACATION_DAYS = 2;

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number; userId: number; vacationDays: number; vacationHoursUsed: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E KrankVertrag ${suffix}`,
      email: `e2e.krankvertrag.${suffix}@dienstplan.test`,
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

  // Bewusst MIT Vertrag — der zu prüfende "remaining von entitlement"-Zustand.
  assistant = await createAssistant(adminCtx, `${unique}`);
  contractId = await createContract(adminCtx, assistant.id);
});

test.afterAll(async () => {
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

test("geplante Krank-Tage verbrauchen bei Assistenten MIT Vertrag keinen Resturlaub", async ({
  page,
}) => {
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/abwesenheiten");
  await expect(page.getByRole("heading", { name: "Abwesenheiten", exact: true })).toBeVisible();

  const row = page.getByTestId(`vacation-balance-row-${assistant.id}`);
  const remaining = page.getByTestId(`vacation-remaining-${assistant.id}`);
  const entitlement = page.getByTestId(`vacation-entitlement-${assistant.id}`);
  const taken = page.getByTestId(`vacation-taken-${assistant.id}`);

  // Ausgangszustand: voller Anspruch, nichts genommen.
  await expect(entitlement).toHaveText(String(VACATION_DAYS));
  await expect(taken).toHaveText("0");
  await expect(remaining).toHaveText(String(VACATION_DAYS));

  // 1) Krank-Tage buchen (4 Tage).
  await bookAbsence(page, assistant.name, "Krank", SICK_FROM, SICK_TO);
  await expect(page.getByTestId("absence-list")).toContainText("Krank");

  // Krank-Tage dürfen den Resturlaub NICHT verändern: weiterhin 0 genommen und
  // voller Resturlaub (sonst stünde hier 4 genommen bzw. 26 Resturlaub).
  await expect(taken).toHaveText("0");
  await expect(remaining).toHaveText(String(VACATION_DAYS));

  // 2) Urlaubs-Tage buchen (2 Tage).
  await bookAbsence(page, assistant.name, "Urlaub", VACATION_FROM, VACATION_TO);
  await expect(page.getByTestId("absence-list")).toContainText("Urlaub");

  // Jetzt zählt der Zähler ausschließlich die Urlaubstage (2), NICHT die
  // Krank-Tage (sonst stünden hier 6 genommen bzw. 24 Resturlaub).
  await expect(taken).toHaveText(String(EXPECTED_VACATION_DAYS));
  await expect(remaining).toHaveText(String(VACATION_DAYS - EXPECTED_VACATION_DAYS));
  await expect(row).toContainText(`von ${VACATION_DAYS}`);

  // Backend-Gegenprobe: vacationDaysUsed des Vertrags zählt nur die Urlaubstage.
  const contractsRes = await adminCtx.get(`/api/contracts?userId=${assistant.id}`);
  expect(contractsRes.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await contractsRes.json()) as Contract[];
  const contract = contracts.find((c) => c.id === contractId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  // Stundengenaue Buchung: Tage = vacationHoursUsed / 8 (vacationHoursPerDay).
  expect(contract!.vacationHoursUsed / 8).toBe(EXPECTED_VACATION_DAYS);
});
