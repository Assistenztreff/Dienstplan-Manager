import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Produktentscheidung (festgeschrieben): Ein Nachtdienst, der am VORTAG beginnt
 * (z. B. 20:00-06:00) und in einen Urlaubstag hineinragt, bleibt beim Anlegen
 * des Urlaubs BEWUSST stehen. Der Dienst gehoert zum Vortag; der Urlaub wird
 * im Anschluss an das Schichtende gerechnet. findPlannedWorkShiftsForDay
 * matcht daher absichtlich nur DATE(startTime) = Urlaubstag.
 *
 * Assertions:
 *  - Der Vortags-Nachtdienst existiert nach dem Urlaub weiter (unveraenderte Zeiten).
 *  - Der Urlaub erbt KEINE Zeiten (kein Dienst startet am Urlaubstag).
 *  - hours-balance-Soll = NUR die Nachtdienst-Stunden (ein rein ganztaegiger
 *    Urlaub 00:00-23:59 zaehlt nach Bestandsverhalten NICHT zum Soll); der
 *    Urlaub zaehlt via valuedHours als Lohnfortzahlung (vacationFulfilledHours).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const YEAR = new Date().getFullYear();
const MONTH = 10;

// Mittwoch im Fenster 10.-16.10. (kein Sonntag, keine bundesweiten Feiertage);
// der Urlaubstag ist der Donnerstag danach.
function findWednesday(): string {
  for (let day = 10; day <= 16; day++) {
    const d = new Date(`${YEAR}-10-${String(day).padStart(2, "0")}T12:00:00`);
    if (d.getDay() === 3) return `${YEAR}-10-${String(day).padStart(2, "0")}`;
  }
  throw new Error("Kein Mittwoch im Fenster 10.-16.10. gefunden");
}
const NIGHT_START_DAY = findWednesday();
const VACATION_DAY = (() => {
  const d = new Date(`${NIGHT_START_DAY}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${YEAR}-10-${String(d.getDate()).padStart(2, "0")}`;
})();

function isoAt(day: string, hour: number): string {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`).toISOString();
}
// Nachtdienst Vortag 20:00 -> Urlaubstag 06:00 (10 h, ragt in den Urlaubstag).
const NIGHT_SHIFT = {
  startTime: isoAt(NIGHT_START_DAY, 20),
  endTime: isoAt(VACATION_DAY, 6),
};

// Ganztaegige Abwesenheit, exakt wie das Frontend sie sendet (00:00-23:59).
function fullDayTimes(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

type CreatedUser = { id: number };
type Shift = {
  id: number;
  startTime: string;
  endTime: string;
  planningStatus?: string | null;
  valuedHours?: number | null;
};
type BalanceRow = {
  userId: number;
  plannedHours: number;
  vacationFulfilledHours: number;
  vacationDaysTaken: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const hoursBetween = (startIso: string, endIso: string) =>
  (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;
let nightShiftId: number;
let vacationShiftId: number;

async function fetchShift(id: number): Promise<Shift> {
  const res = await adminCtx.get(`/api/shifts/${id}`);
  expect(res.ok(), `GET /api/shifts/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Shift;
}

async function fetchBalanceRow(): Promise<BalanceRow> {
  const res = await adminCtx.get(
    `/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`
  );
  expect(res.ok(), `GET hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Assistent fehlt in der Lohnauswertung").toBeTruthy();
  return row!;
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fuer Setup fehlgeschlagen").toBe(true);

  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E VortagsNachtdienst ${unique}`,
      email: `e2e.vortagsnachtdienst.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as CreatedUser).id;

  // Vertrag ab Jahresbeginn: deckt den Urlaubstag (vacation_outside_contract-Guard)
  // und traegt die Urlaubs-Buchhaltung (vacationHoursUsed).
  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Vertrag anlegen fehlgeschlagen (${contractRes.status()})`).toBe(true);
  contractId = ((await contractRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (vacationShiftId) await adminCtx.delete(`/api/shifts/${vacationShiftId}`);
  if (nightShiftId) await adminCtx.delete(`/api/shifts/${nightShiftId}`);
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test("Vortags-Nachtdienst zaehlt vor dem Urlaub allein im Soll", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      ...NIGHT_SHIFT,
    },
  });
  expect(res.status(), `Nachtdienst anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  nightShiftId = ((await res.json()) as Shift).id;

  const row = await fetchBalanceRow();
  expect(row.plannedHours).toBe(
    round2(hoursBetween(NIGHT_SHIFT.startTime, NIGHT_SHIFT.endTime))
  );
});

test("Urlaub am Folgetag laesst den Vortags-Nachtdienst BEWUSST stehen", async () => {
  expect(nightShiftId, "Nachtdienst aus vorherigem Test fehlt").toBeTruthy();

  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "vacation",
      ...fullDayTimes(VACATION_DAY),
    },
  });
  expect(res.status(), `Urlaub anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  vacationShiftId = ((await res.json()) as Shift).id;

  // Kern der Entscheidung: Der Nachtdienst existiert weiter, Zeiten unveraendert.
  const night = await fetchShift(nightShiftId);
  expect(new Date(night.startTime).toISOString()).toBe(NIGHT_SHIFT.startTime);
  expect(new Date(night.endTime).toISOString()).toBe(NIGHT_SHIFT.endTime);

  // Kein Dienst startet am Urlaubstag -> der Urlaub erbt KEINE Dienstzeiten,
  // insbesondere nicht die des Vortags-Nachtdienstes.
  const vacation = await fetchShift(vacationShiftId);
  expect(new Date(vacation.startTime).toISOString()).not.toBe(NIGHT_SHIFT.startTime);
  expect(
    new Date(vacation.startTime).toISOString().slice(0, 10),
    "Urlaub muss am Urlaubstag beginnen"
  ).toBe(new Date(`${VACATION_DAY}T00:00:00`).toISOString().slice(0, 10));
});

test("Soll = nur Nachtdienst; Urlaub zaehlt als Lohnfortzahlung", async () => {
  expect(nightShiftId && vacationShiftId, "Fixtures aus vorherigen Tests fehlen").toBeTruthy();

  const vacation = await fetchShift(vacationShiftId);
  const vacationHours = round2(vacation.valuedHours ?? 0);
  expect(vacationHours, "Urlaubs-valuedHours muessen > 0 sein").toBeGreaterThan(0);

  const nightHours = round2(
    hoursBetween(NIGHT_SHIFT.startTime, NIGHT_SHIFT.endTime)
  );
  const row = await fetchBalanceRow();

  // Der Nachtdienst bleibt vollstaendig im Soll stehen (gehoert zum Vortag);
  // der rein ganztaegige Urlaub (00:00-23:59) zaehlt NICHT zusaetzlich zum
  // Soll, sondern als Lohnfortzahlung. Das ist die dokumentierte
  // Produktentscheidung — kein stilles Doppel-Soll.
  expect(row.plannedHours).toBe(nightHours);
  expect(row.vacationFulfilledHours).toBe(vacationHours);
  expect(row.vacationDaysTaken).toBe(1);
});
