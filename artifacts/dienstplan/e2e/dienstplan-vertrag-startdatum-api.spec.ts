import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Tests: Vertragsbeginn (startDate) änderbar + Urlaubszähler-Neuberechnung.
 *
 * Abgesichert wird:
 * - PATCH /contracts/:id mit startDate wird persistiert (springt nicht zurück).
 * - Nach JEDEM Speichern (POST und PATCH) wird vacationHoursUsed aus den
 *   tatsächlich vorhandenen Urlaubs-Schichten im Vertragszeitraum neu
 *   berechnet: Vorziehen des Beginns verbucht einen vorher unverbuchten
 *   Urlaub, Zurückschieben entlastet den Zähler.
 * - Urlaubs-Schichten selbst bleiben unverändert (nur der Zähler bewegt sich).
 * - startDate nach endDate -> 400 mit klarer Meldung.
 *
 * Der "unverbuchte" Alt-Urlaub entsteht, indem er VOR der Vertragsanlage
 * eingetragen wird (ohne jeden Vertrag ist Urlaub uneingeschränkt erlaubt und
 * es existiert kein Zähler, der belastet werden könnte).
 *
 * Alle Daten liegen in der Vergangenheit (relativ zum Testlauf).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

function monthShift(deltaMonths: number, day: number): string {
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth() + deltaMonths, day);
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  return `${t.getFullYear()}-${mm}-${dd}`;
}

// Alt-Urlaub 3 Monate zurück; Vertrag beginnt zunächst NACH dem Urlaub
// (Vormonat), wird dann davor gezogen und wieder zurückgeschoben.
const VACATION_DAY = monthShift(-3, 10);
const LATE_START = monthShift(-1, 1);
const EARLY_START = monthShift(-4, 1);
const CONTRACT_END = monthShift(0, 28);
const START_AFTER_END = monthShift(1, 5);

function dayIso(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

type Contract = { id: number; startDate: string; vacationHoursUsed: number };
type Shift = { id: number; userId: number; startTime: string; endTime: string };

let adminCtx: APIRequestContext;
let userId: number;
let contractId: number;
let vacationShiftId: number;

async function getContract(): Promise<Contract> {
  const res = await adminCtx.get(`/api/contracts?userId=${userId}`);
  expect(res.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await res.json()) as Contract[];
  const contract = contracts.find((c) => c.id === contractId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  return contract!;
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Startdatum ${unique}`,
      email: `e2e.startdatum.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), "Anlegen des Assistenten fehlgeschlagen").toBe(true);
  userId = ((await userRes.json()) as { id: number }).id;

  // Alt-Urlaub VOR jedem Vertrag: uneingeschränkt erlaubt, nirgends verbucht.
  const vacRes = await adminCtx.post("/api/shifts", {
    data: { userId, type: "vacation", ...dayIso(VACATION_DAY) },
  });
  expect(vacRes.status(), "Alt-Urlaub sollte 201 liefern").toBe(201);
  vacationShiftId = ((await vacRes.json()) as Shift).id;
});

test.afterAll(async () => {
  if (vacationShiftId) await adminCtx.delete(`/api/shifts/${vacationShiftId}`);
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (userId) await adminCtx.delete(`/api/users/${userId}`);
  await adminCtx.dispose();
});

test("POST /contracts berechnet den Zähler neu: Urlaub vor Vertragsbeginn zählt nicht", async () => {
  const res = await adminCtx.post("/api/contracts", {
    data: { userId, startDate: LATE_START, weeklyHours: 40, vacationDays: 30 },
  });
  expect(res.status(), "Vertrag anlegen sollte 201 liefern").toBe(201);
  const contract = (await res.json()) as Contract;
  contractId = contract.id;
  expect(contract.startDate).toBe(LATE_START);
  expect(contract.vacationHoursUsed).toBe(0);
});

test("PATCH startDate wird persistiert und Vorziehen verbucht den Alt-Urlaub", async () => {
  const res = await adminCtx.patch(`/api/contracts/${contractId}`, {
    data: { startDate: EARLY_START },
  });
  expect(res.status(), "PATCH startDate sollte 200 liefern").toBe(200);
  const body = (await res.json()) as Contract;
  expect(body.startDate).toBe(EARLY_START);
  // 1 ganztägiger Urlaubstag = 8 Stunden (vacationHoursPerDay-Default).
  expect(body.vacationHoursUsed).toBe(8);

  // Persistiert (springt nicht zurück) — frisch aus der Liste gelesen.
  const fresh = await getContract();
  expect(fresh.startDate).toBe(EARLY_START);
  expect(fresh.vacationHoursUsed).toBe(8);

  // Die Urlaubs-Schicht selbst bleibt unverändert bestehen.
  const shiftRes = await adminCtx.get(`/api/shifts/${vacationShiftId}`);
  expect(shiftRes.ok(), "Urlaubs-Schicht muss weiterhin existieren").toBe(true);
  const shift = (await shiftRes.json()) as Shift;
  expect(shift.startTime.split("T")[0]).toBe(
    new Date(`${VACATION_DAY}T00:00:00`).toISOString().split("T")[0]
  );
});

test("Zurückschieben des Beginns entlastet den Zähler wieder", async () => {
  const res = await adminCtx.patch(`/api/contracts/${contractId}`, {
    data: { startDate: LATE_START },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as Contract;
  expect(body.startDate).toBe(LATE_START);
  expect(body.vacationHoursUsed).toBe(0);

  // Urlaubs-Schicht bleibt auch hier unangetastet.
  const shiftRes = await adminCtx.get(`/api/shifts/${vacationShiftId}`);
  expect(shiftRes.ok()).toBe(true);
});

test("startDate nach endDate wird mit 400 abgelehnt, Vertrag bleibt unverändert", async () => {
  const endRes = await adminCtx.patch(`/api/contracts/${contractId}`, {
    data: { endDate: CONTRACT_END },
  });
  expect(endRes.status(), "endDate setzen sollte 200 liefern").toBe(200);

  const res = await adminCtx.patch(`/api/contracts/${contractId}`, {
    data: { startDate: START_AFTER_END },
  });
  expect(res.status(), "startDate > endDate sollte 400 liefern").toBe(400);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toContain("Beginndatum");

  const fresh = await getContract();
  expect(fresh.startDate).toBe(LATE_START);
});
