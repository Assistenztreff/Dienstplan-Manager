import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test für den serverseitigen Schutz gegen doppelte Abwesenheiten.
 *
 * Der reine Backend-Schutz (POST /api/shifts gibt 409 "absence_duplicate" bei
 * gleichem Nutzer + Typ + Tag, BEVOR insert/vacationDaysUsed-Erhöhung läuft) war
 * bisher nur manuell per curl geprüft. Dieser Test sichert direkt gegen die API
 * ab (ohne UI, da der Schutz serverseitig greift und auch bei umgangenem
 * Frontend gelten muss):
 * - Erste Urlaubsschicht wird angelegt (201).
 * - Identischer Payload erneut -> 409 mit code "absence_duplicate" und der
 *   existingShiftId der ersten Schicht; KEIN zweiter Eintrag entsteht.
 * - vacationDaysUsed des Vertrags wird durch den abgelehnten Zweitversuch NICHT
 *   erneut erhöht.
 * - Eine Krank-Schicht am selben Tag bleibt erlaubt (201, anderer Typ).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const VACATION_DAYS = 30;
const YEAR = new Date().getFullYear();
const CONTRACT_START = `${YEAR}-01-01`;
// Einzelner Tag mitten im Jahr, robust gegen Vertrags-/Jahresgrenzen.
const ABSENCE_DAY = `${YEAR}-06-15`;
const START_ISO = new Date(`${ABSENCE_DAY}T00:00:00`).toISOString();
const END_ISO = new Date(`${ABSENCE_DAY}T23:59:59`).toISOString();

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number; userId: number; vacationDays: number; vacationDaysUsed: number };
type Shift = { id: number; userId: number; type: string };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E Duplikat API ${suffix}`,
      email: `e2e.duplikat.api.${suffix}@dienstplan.test`,
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

async function vacationDaysUsed(ctx: APIRequestContext, userId: number, cId: number): Promise<number> {
  const res = await ctx.get(`/api/contracts?userId=${userId}`);
  expect(res.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await res.json()) as Contract[];
  const contract = contracts.find((c) => c.id === cId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  return contract!.vacationDaysUsed;
}

async function listShifts(
  ctx: APIRequestContext,
  userId: number,
  type: string
): Promise<Shift[]> {
  const res = await ctx.get(`/api/shifts?type=${type}&userId=${userId}`);
  expect(res.ok(), `GET /api/shifts (${type}) fehlgeschlagen`).toBe(true);
  const shifts = (await res.json()) as Shift[];
  return shifts.filter((s) => s.userId === userId);
}

function absencePayload(type: "vacation" | "sick") {
  return {
    userId: assistant.id,
    type,
    startTime: START_ISO,
    endTime: END_ISO,
  };
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
  for (const type of ["vacation", "sick"]) {
    const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistant.id}`);
    if (res.ok()) {
      const shifts = (await res.json()) as Shift[];
      for (const s of shifts.filter((s) => s.userId === assistant.id)) {
        await adminCtx.delete(`/api/shifts/${s.id}`);
      }
    }
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistant?.id) await adminCtx.delete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test("POST /api/shifts lehnt doppelte Urlaubstage serverseitig mit 409 ab, ohne Doppelabzug", async () => {
  // --- Erste Urlaubsschicht: wird angelegt (201) ---
  const firstRes = await adminCtx.post("/api/shifts", { data: absencePayload("vacation") });
  expect(firstRes.status(), "Erste Urlaubsschicht sollte 201 liefern").toBe(201);
  const firstShift = (await firstRes.json()) as Shift;

  // Resturlaub-Buchung greift: vacationDaysUsed auf 1.
  expect(await vacationDaysUsed(adminCtx, assistant.id, contractId)).toBe(1);
  expect((await listShifts(adminCtx, assistant.id, "vacation")).length).toBe(1);

  // --- Identischer Payload erneut: 409 absence_duplicate, kein zweiter Eintrag ---
  const dupRes = await adminCtx.post("/api/shifts", { data: absencePayload("vacation") });
  expect(dupRes.status(), "Zweiter identischer Urlaub sollte 409 liefern").toBe(409);
  const dupBody = (await dupRes.json()) as { code?: string; existingShiftId?: number };
  expect(dupBody.code).toBe("absence_duplicate");
  // Verweist auf die bereits existierende Schicht.
  expect(dupBody.existingShiftId).toBe(firstShift.id);

  // Kein zweiter Eintrag entstanden.
  expect((await listShifts(adminCtx, assistant.id, "vacation")).length).toBe(1);
  // vacationDaysUsed NICHT erneut erhöht (weiterhin 1).
  expect(await vacationDaysUsed(adminCtx, assistant.id, contractId)).toBe(1);

  // --- Krank-Schicht am selben Tag bleibt erlaubt (anderer Typ) ---
  const sickRes = await adminCtx.post("/api/shifts", { data: absencePayload("sick") });
  expect(sickRes.status(), "Krank am selben Tag sollte 201 liefern (anderer Typ)").toBe(201);
  expect((await listShifts(adminCtx, assistant.id, "sick")).length).toBe(1);
  // Krank zählt nicht auf den Urlaubsanspruch.
  expect(await vacationDaysUsed(adminCtx, assistant.id, contractId)).toBe(1);
});
