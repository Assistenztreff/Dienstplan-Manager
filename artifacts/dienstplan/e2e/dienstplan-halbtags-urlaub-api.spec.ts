import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Tests fuer halbtaegigen Urlaub (Task #862): POST /api/shifts/bulk-absence
 * akzeptiert fuer EINEN Tag echte Uhrzeiten statt nur des Ganztages-Fallbacks
 * (00:00–23:59). Ein Tageseintrag mit echten Uhrzeiten wird NICHT wie ein
 * ganztaegiger Eintrag behandelt:
 *
 *  1. Zeiten werden 1:1 uebernommen (kein Erben von Dienstzeiten).
 *  2. Nur Dienste, die sich ECHT zeitlich ueberschneiden, werden ersetzt
 *     (Lohnausfallprinzip) — ein Dienst ausserhalb des Zeitfensters bleibt
 *     unberuehrt (anders als beim ganztaegigen Fall, der den ganzen Tag
 *     beansprucht).
 *  3. Ein neuer Dienst, der sich mit dem halbtaegigen Urlaub ueberschneidet,
 *     wird mit 409 abgelehnt (echte Kollisionspruefung, anders als bei
 *     ganztaegigem Urlaub, der nie kollidiert).
 *  4. DELETE des halbtaegigen Urlaubs erstattet nur die anteiligen Stunden
 *     (kein voller Vertragstag).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const YEAR = new Date().getFullYear();
const CONTRACT_START = `${YEAR}-01-01`;

function iso(day: string, hhmm: string): string {
  return new Date(`${day}T${hhmm}:00`).toISOString();
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
  replacedShiftIds: number[];
};

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;

async function bulkAbsenceRange(
  type: string,
  days: { startTime: string; endTime: string }[],
): Promise<{ status: number; body: BulkResult & { error?: string; code?: string } }> {
  const res = await adminCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type, days },
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

async function listShifts(type: string): Promise<Shift[]> {
  const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
  expect(res.ok(), `GET /api/shifts (${type}) fehlgeschlagen`).toBe(true);
  return ((await res.json()) as Shift[]).filter((s) => s.userId === assistantId);
}

async function deleteShift(id: number): Promise<void> {
  const res = await adminCtx.delete(`/api/shifts/${id}`);
  expect(res.ok(), `DELETE /api/shifts/${id} fehlgeschlagen`).toBe(true);
}

async function cleanupAllShifts(): Promise<void> {
  for (const type of ["vacation", "sick", "active"]) {
    for (const s of await listShifts(type)) {
      await adminCtx.delete(`/api/shifts/${s.id}`);
    }
  }
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
      name: `E2E Halbtag Urlaub ${unique}`,
      email: `e2e.halbtag.urlaub.${unique}@dienstplan.test`,
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
  await cleanupAllShifts();
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test.afterEach(async () => {
  await cleanupAllShifts();
});

test("legt Halbtags-Urlaub mit den exakt gewaehlten Uhrzeiten an (kein Ganztages-Fallback)", async () => {
  const day = dayString("05-11");
  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(status, "Halbtags-Urlaub sollte 201 liefern").toBe(201);
  expect(body.createdCount).toBe(1);

  const vacations = await listShifts("vacation");
  expect(vacations).toHaveLength(1);
  expect(vacations[0]!.startTime).toBe(iso(day, "13:00"));
  expect(vacations[0]!.endTime).toBe(iso(day, "17:00"));
});

test("Dienst ausserhalb des Urlaubsfensters bleibt am selben Tag bestehen (Koexistenz)", async () => {
  const day = dayString("05-12");
  const morningRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "08:00"),
      endTime: iso(day, "12:00"),
    },
  });
  expect(morningRes.status(), "Vormittags-Dienst anlegen sollte 201 liefern").toBe(201);
  const morningId = ((await morningRes.json()) as Shift).id;

  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(status).toBe(201);
  expect(body.createdCount).toBe(1);
  expect(body.replacedShiftIds).not.toContain(morningId);

  const stillThere = await adminCtx.get(`/api/shifts/${morningId}`);
  expect(stillThere.status(), "Dienst ausserhalb des Zeitfensters muss erhalten bleiben").toBe(200);
});

test("Dienst, der sich ECHT mit dem Urlaubsfenster ueberschneidet, wird ersetzt (Lohnausfallprinzip)", async () => {
  const day = dayString("05-13");
  const overlapRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "10:00"),
      endTime: iso(day, "14:00"),
    },
  });
  expect(overlapRes.status(), "Ueberlappenden Dienst anlegen sollte 201 liefern").toBe(201);
  const overlapId = ((await overlapRes.json()) as Shift).id;

  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(status).toBe(201);
  expect(body.createdCount).toBe(1);
  expect(body.replacedShiftIds).toContain(overlapId);

  const gone = await adminCtx.get(`/api/shifts/${overlapId}`);
  expect(gone.status(), "Ueberlappender Dienst muss ersetzt (geloescht) worden sein").toBe(404);

  // Der halbtaegige Urlaub uebernimmt NICHT die Zeiten des ersetzten Dienstes
  // (10-14), sondern behaelt die vom Nutzer gewaehlten Zeiten (13-17) —
  // anders als beim ganztaegigen Fall (dort wird geerbt).
  const vacations = await listShifts("vacation");
  expect(vacations[0]!.startTime).toBe(iso(day, "13:00"));
  expect(vacations[0]!.endTime).toBe(iso(day, "17:00"));
});

test("ein neuer Dienst, der den bestehenden Halbtags-Urlaub ueberschneidet, wird mit 409 abgelehnt", async () => {
  const day = dayString("05-14");
  const { status: vacStatus } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(vacStatus).toBe(201);

  const conflictRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "15:00"),
      endTime: iso(day, "19:00"),
    },
  });
  expect(conflictRes.status(), "Dienst ueber Halbtags-Urlaub sollte 409 liefern").toBe(409);

  // Dienst, der ausserhalb des Urlaubsfensters liegt, bleibt weiterhin erlaubt.
  const okRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "17:00"),
      endTime: iso(day, "19:00"),
    },
  });
  expect(okRes.status(), "Dienst direkt nach dem Urlaubsende sollte 201 liefern").toBe(201);
});

test("DELETE eines Halbtags-Urlaubs erstattet nur die anteiligen Stunden (kein voller Vertragstag)", async () => {
  const day = dayString("05-15");
  const baseline = await vacationHoursUsed();

  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: iso(day, "13:00"), endTime: iso(day, "17:00") },
  ]);
  expect(status).toBe(201);
  const afterCreate = await vacationHoursUsed();
  const bookedHalfDay = afterCreate - baseline;
  expect(bookedHalfDay, "Halbtags-Urlaub soll ~4h buchen, nicht den vollen Vertragstag (8h)").toBeCloseTo(4, 1);

  await deleteShift(body.shiftIds[0]!);
  const afterDelete = await vacationHoursUsed();
  expect(afterDelete, "Loeschen muss die anteiligen Stunden vollstaendig erstatten").toBeCloseTo(baseline, 2);
});

test("Regression: ganztaegiger Urlaub verhaelt sich weiterhin wie bisher (erbt Dienstzeiten, kollidiert nie)", async () => {
  const day = dayString("05-18");
  const workRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "08:00"),
      endTime: iso(day, "14:00"),
    },
  });
  expect(workRes.status()).toBe(201);
  const workId = ((await workRes.json()) as Shift).id;

  const { status, body } = await bulkAbsenceRange("vacation", [
    { startTime: `${day}T00:00:00.000Z`, endTime: `${day}T23:59:59.000Z` },
  ]);
  expect(status).toBe(201);
  expect(body.createdCount).toBe(1);
  expect(body.replacedShiftIds).toContain(workId);

  const vacations = await listShifts("vacation");
  expect(vacations[0]!.startTime, "Ganztaegiger Urlaub erbt weiterhin Dienstzeiten").toBe(iso(day, "08:00"));
  expect(vacations[0]!.endTime).toBe(iso(day, "14:00"));

  // Ganztaegiger Urlaub kollidiert weiterhin nicht mit neuen Diensten.
  const laterRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: iso(day, "18:00"),
      endTime: iso(day, "20:00"),
    },
  });
  expect(laterRes.status(), "Ganztaegiger Urlaub darf weiterhin keine Kollision ausloesen").toBe(201);
});
