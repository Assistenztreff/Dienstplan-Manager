import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Tests fuer den Sammel-Endpunkt POST /api/shifts/bulk-absence (Task #715):
 * Abwesenheits-Zeitraeume werden in EINEM Request transaktional angelegt statt
 * Tag fuer Tag (Einzel-POSTs kosten ~Sekunden pro Tag durch die Urlaubskonto-
 * Fortschreibung; Netzwerkfehler hinterliessen Teil-Zeitraeume).
 *
 * Abgesichert wird:
 *  1. Mehrtaegiger Urlaub in einem Request; das Urlaubskonto wird EXAKT so
 *     fortgeschrieben wie bei N Einzel-POSTs (Kern-Invariante des Umbaus).
 *  2. Zeitraum ueber eine Monatsgrenze; Tage mit bestehender Abwesenheit
 *     desselben Typs werden UEBERSPRUNGEN und gemeldet (kein 409-Abbruch);
 *     komplett vorhandener Zeitraum -> createdCount 0.
 *  3. Rollback: Liegt EIN Urlaubstag ausserhalb des Vertragszeitraums
 *     (vacation_outside_contract), wird KEIN einziger Tag angelegt und das
 *     Urlaubskonto bleibt unveraendert (ganz oder gar nicht).
 *  4. Lohnausfallprinzip pro Tag: geplante Dienste am Abwesenheitstag werden
 *     geloescht, die Abwesenheit erbt deren Zeiten; Tage ohne Dienst bleiben
 *     ganztaegig. Abwesenheiten sind immer FIX.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const YEAR = new Date().getFullYear();
// Vertrag beginnt bewusst NICHT am Jahresanfang, damit der Rollback-Fall
// (Urlaubstage vor Vertragsbeginn) innerhalb desselben Jahres testbar ist.
const CONTRACT_START = `${YEAR}-03-01`;

// Ganztaegige Zeiten, exakt wie das Frontend sie sendet (00:00–23:59).
function fullDay(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

function dayString(monthDay: string): string {
  return `${YEAR}-${monthDay}`;
}

type CreatedUser = { id: number };
type Contract = { id: number; vacationHoursUsed: number };
type Shift = {
  id: number;
  userId: number;
  type: string;
  startTime: string;
  endTime: string;
  planningStatus?: string | null;
};
type BulkResult = {
  createdCount: number;
  skippedCount: number;
  skippedDates: string[];
  shiftIds: number[];
};

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;

async function bulkAbsence(
  type: string,
  days: string[],
): Promise<{ status: number; body: BulkResult & { error?: string; code?: string } }> {
  const res = await adminCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type, days: days.map(fullDay) },
  });
  return {
    status: res.status(),
    body: (await res.json()) as BulkResult & { error?: string; code?: string },
  };
}

async function vacationHoursUsed(): Promise<number> {
  const res = await adminCtx.get(`/api/contracts?userId=${assistantId}`);
  expect(res.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await res.json()) as Contract[];
  const contract = contracts.find((c) => c.id === contractId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  return contract!.vacationHoursUsed;
}

async function listAbsences(type: string): Promise<Shift[]> {
  const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
  expect(res.ok(), `GET /api/shifts (${type}) fehlgeschlagen`).toBe(true);
  return ((await res.json()) as Shift[]).filter((s) => s.userId === assistantId);
}

async function deleteShift(id: number): Promise<void> {
  const res = await adminCtx.delete(`/api/shifts/${id}`);
  expect(res.ok(), `DELETE /api/shifts/${id} fehlgeschlagen`).toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fuer Setup fehlgeschlagen").toBe(true);

  const unique = Date.now();
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Bulk Absence ${unique}`,
      email: `e2e.bulk.absence.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen der Assistenzkraft fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as CreatedUser).id;

  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: CONTRACT_START,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(true);
  contractId = ((await contractRes.json()) as Contract).id;
});

test.afterAll(async () => {
  for (const type of ["vacation", "sick", "active"]) {
    const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
    if (res.ok()) {
      const shifts = (await res.json()) as Shift[];
      for (const s of shifts.filter((s) => s.userId === assistantId)) {
        await adminCtx.delete(`/api/shifts/${s.id}`);
      }
    }
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test("bucht einen mehrtaegigen Urlaubszeitraum in einem Request und das Urlaubskonto wie Einzel-Anlagen", async () => {
  // Einzel-POSTs mit Urlaubskonto-Fortschreibung dauern ~5s pro Tag.
  test.setTimeout(120_000);
  const days = [dayString("06-15"), dayString("06-16"), dayString("06-17")];

  const baselineBulk = await vacationHoursUsed();
  const { status, body } = await bulkAbsence("vacation", days);
  expect(status, "Sammel-Anlage sollte 201 liefern").toBe(201);
  expect(body.createdCount).toBe(3);
  expect(body.skippedCount).toBe(0);
  expect(body.shiftIds).toHaveLength(3);
  expect((await listAbsences("vacation")).length).toBe(3);
  const deltaBulk = (await vacationHoursUsed()) - baselineBulk;
  expect(deltaBulk, "Sammel-Anlage muss Urlaubsstunden buchen").toBeGreaterThan(0);

  // Referenz: dieselben Tage als Einzel-POSTs muessen dieselbe Buchung ergeben.
  for (const id of body.shiftIds) await deleteShift(id);
  const baselineSingle = await vacationHoursUsed();
  for (const day of days) {
    const res = await adminCtx.post("/api/shifts", {
      data: { userId: assistantId, type: "vacation", ...fullDay(day) },
    });
    expect(res.status(), `Einzel-Urlaub ${day} sollte 201 liefern`).toBe(201);
  }
  const deltaSingle = (await vacationHoursUsed()) - baselineSingle;
  expect(deltaBulk, "Sammel-Buchung muss Einzel-Buchungen entsprechen").toBeCloseTo(deltaSingle, 2);

  // Aufraeumen fuer die Folgetests (Urlaubs-Bestand zuruecksetzen).
  for (const s of await listAbsences("vacation")) await deleteShift(s.id);
});

test("ueberspringt vorhandene Tage statt 409 und traegt ueber Monatsgrenzen ein", async () => {
  // Zeitraum ueber die Monatsgrenze September -> Oktober.
  const firstRange = [
    dayString("09-29"),
    dayString("09-30"),
    dayString("10-01"),
    dayString("10-02"),
  ];
  const first = await bulkAbsence("sick", firstRange);
  expect(first.status).toBe(201);
  expect(first.body.createdCount).toBe(4);
  expect(first.body.skippedCount).toBe(0);

  // Erweiterter Zeitraum: nur der neue Tag wird angelegt, der Rest gemeldet.
  const second = await bulkAbsence("sick", [dayString("09-28"), ...firstRange]);
  expect(second.status).toBe(201);
  expect(second.body.createdCount).toBe(1);
  expect(second.body.skippedCount).toBe(4);
  expect(second.body.skippedDates.sort()).toEqual(firstRange);
  expect((await listAbsences("sick")).length).toBe(5);

  // Komplett vorhandener Zeitraum: nichts angelegt, alles gemeldet.
  const third = await bulkAbsence("sick", [dayString("09-28"), ...firstRange]);
  expect(third.status).toBe(201);
  expect(third.body.createdCount).toBe(0);
  expect(third.body.skippedCount).toBe(5);
  expect((await listAbsences("sick")).length).toBe(5);
});

test("legt bei Urlaub ausserhalb des Vertragszeitraums KEINEN einzigen Tag an", async () => {
  const baseline = await vacationHoursUsed();
  const existingVacations = (await listAbsences("vacation")).length;

  // Die ersten Tage liegen VOR dem Vertragsbeginn (01.03.), die letzten
  // dahinter — ohne Transaktion entstuende ein Teil-Zeitraum ab dem 01.03.
  const { status, body } = await bulkAbsence("vacation", [
    dayString("02-26"),
    dayString("02-27"),
    dayString("03-02"),
    dayString("03-03"),
  ]);
  expect(status, "Urlaub vor Vertragsbeginn sollte 400 liefern").toBe(400);
  expect(body.code).toBe("vacation_outside_contract");

  expect((await listAbsences("vacation")).length, "Kein Teil-Zeitraum").toBe(existingVacations);
  expect(await vacationHoursUsed(), "Urlaubskonto unveraendert").toBe(baseline);
});

test("zwei GLEICHZEITIGE identische Zeitraeume buchen jeden Tag nur einmal", async () => {
  // Doppelklick-Schutz: Ohne Advisory-Lock saehen beide Requests "Tag ist
  // frei" und buchten die Abwesenheit doppelt (inkl. doppeltem Urlaubsabzug).
  test.setTimeout(120_000);
  const days = [dayString("11-16"), dayString("11-17")];
  const [a, b] = await Promise.all([
    bulkAbsence("sick", days),
    bulkAbsence("sick", days),
  ]);
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(a.body.createdCount + b.body.createdCount, "jeder Tag nur EINMAL angelegt").toBe(2);
  expect(a.body.skippedCount + b.body.skippedCount, "der langsamere ueberspringt beide Tage").toBe(2);

  const november = (await listAbsences("sick")).filter((s) =>
    days.some((d) => s.startTime.startsWith(d)),
  );
  expect(november.length).toBe(2);
});

test("ersetzt geplante Dienste am Abwesenheitstag und erbt deren Zeiten", async () => {
  const dayWithShift = dayString("10-14");
  const dayWithout = dayString("10-15");
  const shiftStart = new Date(`${dayWithShift}T08:00:00`).toISOString();
  const shiftEnd = new Date(`${dayWithShift}T14:00:00`).toISOString();
  const workRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: shiftStart,
      endTime: shiftEnd,
    },
  });
  expect(workRes.status(), "Dienst anlegen sollte 201 liefern").toBe(201);
  const workShiftId = ((await workRes.json()) as Shift).id;

  const { status, body } = await bulkAbsence("sick", [dayWithShift, dayWithout]);
  expect(status).toBe(201);
  expect(body.createdCount).toBe(2);

  // Der geplante Dienst ist geloescht (Lohnausfallprinzip) ...
  const gone = await adminCtx.get(`/api/shifts/${workShiftId}`);
  expect(gone.status(), "Ersetzter Dienst muss geloescht sein").toBe(404);

  // ... die Abwesenheit traegt seine Zeiten; der Tag ohne Dienst bleibt ganztaegig.
  const sickShifts = await listAbsences("sick");
  const inherited = sickShifts.find((s) => s.startTime === shiftStart);
  expect(inherited, "Abwesenheit muss die Dienstzeiten erben").toBeTruthy();
  expect(inherited!.endTime).toBe(shiftEnd);
  expect(inherited!.planningStatus).toBe("FIX");
  const untouched = sickShifts.find(
    (s) => s.startTime === new Date(`${dayWithout}T00:00:00`).toISOString(),
  );
  expect(untouched, "Tag ohne Dienst bleibt ganztaegig").toBeTruthy();
});
