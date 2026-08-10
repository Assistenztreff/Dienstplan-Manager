import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Tests fuer den Sammel-Endpunkt POST /api/shifts/bulk-delete (Task #751):
 * Mehrfach-Loeschungen laufen in EINEM transaktionalen Request statt als N
 * Einzel-DELETEs (Einzel-Loeschungen kosteten 2–3 s pro Eintrag; Abbrueche
 * hinterliessen halb geloeschte Auswahlen).
 *
 * Abgesichert wird (Muster: dienstplan-bulk-absence-api.spec.ts):
 *  1. Mehrere Dienste in einem Request loeschen; Duplikat-IDs im Batch sind
 *     tolerant (doppelte ID = derselbe Eintrag).
 *  2. Ganz oder gar nicht: EINE unbekannte oder mandantenfremde ID im Batch
 *     -> 404 und KEIN einziger Eintrag wird geloescht (kein ID-Orakel: fremde
 *     und fehlende IDs sind nicht unterscheidbar).
 *  3. Urlaub: das Urlaubskonto wird EXAKT so zurueckgebucht wie bei N
 *     Einzel-DELETEs (Kern-Invariante: Sammel-Route spiegelt Einzel-Route).
 *  4. Die automatisch gebuchte Zeiterfassung von Abwesenheiten wird mit
 *     geloescht (keine verwaisten Ist-Zeiten).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const YEAR = new Date().getFullYear();
// Vertrag beginnt bewusst NICHT am Jahresanfang (gleiches Muster wie der
// Bulk-Absence-Spec, haelt die Urlaubslogik innerhalb desselben Jahres).
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
type Shift = { id: number; userId: number; type: string; startTime: string };
type BulkAbsenceResult = { createdCount: number; shiftIds: number[] };
type BulkDeleteResult = { deletedIds: number[]; error?: string };
type TimeEntry = { id: number; shiftId: number | null };

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;

async function bulkDelete(
  ids: number[],
): Promise<{ status: number; body: BulkDeleteResult }> {
  const res = await adminCtx.post("/api/shifts/bulk-delete", { data: { ids } });
  return { status: res.status(), body: (await res.json()) as BulkDeleteResult };
}

async function vacationHoursUsed(): Promise<number> {
  const res = await adminCtx.get(`/api/contracts?userId=${assistantId}`);
  expect(res.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await res.json()) as Contract[];
  const contract = contracts.find((c) => c.id === contractId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  return contract!.vacationHoursUsed;
}

async function listShiftsOf(type: string): Promise<Shift[]> {
  const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
  expect(res.ok(), `GET /api/shifts (${type}) fehlgeschlagen`).toBe(true);
  return ((await res.json()) as Shift[]).filter((s) => s.userId === assistantId);
}

async function createWorkShift(day: string, startHM: string, endHM: string): Promise<number> {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      startTime: new Date(`${day}T${startHM}:00`).toISOString(),
      endTime: new Date(`${day}T${endHM}:00`).toISOString(),
    },
  });
  expect(res.status(), `Dienst ${day} anlegen sollte 201 liefern`).toBe(201);
  return ((await res.json()) as Shift).id;
}

async function bulkAbsence(type: string, days: string[]): Promise<number[]> {
  const res = await adminCtx.post("/api/shifts/bulk-absence", {
    data: { userId: assistantId, type, days: days.map(fullDay) },
  });
  expect(res.status(), `Sammel-Anlage (${type}) sollte 201 liefern`).toBe(201);
  const body = (await res.json()) as BulkAbsenceResult;
  expect(body.createdCount).toBe(days.length);
  return body.shiftIds;
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
      name: `E2E Bulk Delete ${unique}`,
      email: `e2e.bulk.delete.${unique}@dienstplan.test`,
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

test("loescht mehrere Dienste in einem Request (Duplikat-IDs toleriert)", async () => {
  const a = await createWorkShift(dayString("11-03"), "08:00", "14:00");
  const b = await createWorkShift(dayString("11-04"), "08:00", "14:00");
  const c = await createWorkShift(dayString("11-05"), "08:00", "14:00");

  // Doppelte ID im Batch = derselbe Eintrag, kein Fehler.
  const { status, body } = await bulkDelete([a, a, b, c]);
  expect(status, "Sammel-Loeschen sollte 200 liefern").toBe(200);
  expect([...body.deletedIds].sort((x, y) => x - y)).toEqual([a, b, c].sort((x, y) => x - y));

  for (const id of [a, b, c]) {
    const gone = await adminCtx.get(`/api/shifts/${id}`);
    expect(gone.status(), `Eintrag ${id} muss geloescht sein`).toBe(404);
  }
  expect((await listShiftsOf("active")).length).toBe(0);
});

test("ganz oder gar nicht: unbekannte oder fremde IDs loeschen NICHTS", async () => {
  const a = await createWorkShift(dayString("11-10"), "08:00", "14:00");
  const b = await createWorkShift(dayString("11-11"), "08:00", "14:00");

  // Unbekannte ID im Batch -> 404, beide eigenen Eintraege bleiben bestehen.
  const missing = await bulkDelete([a, b, 99_999_999]);
  expect(missing.status, "Unbekannte ID muss 404 liefern").toBe(404);
  for (const id of [a, b]) {
    const still = await adminCtx.get(`/api/shifts/${id}`);
    expect(still.status(), `Eintrag ${id} darf NICHT geloescht sein`).toBe(200);
  }

  // Mandantenfremde ID: eigener Dienst eines fremden Kontos (eigenes
  // Standard-Team). Gleiche 404-Antwort wie "fehlt" — kein ID-Orakel.
  let foreign: FreeAccount | undefined;
  try {
    foreign = await registerFreeAccount("privat", "bulkdel");
    // Fremd-Dienst am HEUTIGEN Tag: das frische Konto ist Free und darf nur
    // bis naechsten Monat vorausplanen (Vorausplanungs-Limit) — ein Termin im
    // November wuerde am Plan-Gate scheitern, nicht an der Tenant-Grenze.
    const today = new Date().toISOString().split("T")[0]!;
    const foreignShiftRes = await foreign.ctx.post("/api/shifts", {
      data: {
        userId: foreign.id,
        type: "active",
        planningStatus: "FIX",
        ...fullDay(today),
      },
    });
    expect(
      foreignShiftRes.status(),
      `Fremd-Dienst anlegen sollte 201 liefern (${foreignShiftRes.status()})`,
    ).toBe(201);
    const foreignShiftId = ((await foreignShiftRes.json()) as Shift).id;

    const crossTenant = await bulkDelete([a, foreignShiftId]);
    expect(crossTenant.status, "Fremde ID muss 404 liefern").toBe(404);

    const ownStill = await adminCtx.get(`/api/shifts/${a}`);
    expect(ownStill.status(), "Eigener Eintrag darf NICHT geloescht sein").toBe(200);
    const foreignStill = await foreign.ctx.get(`/api/shifts/${foreignShiftId}`);
    expect(foreignStill.status(), "Fremder Eintrag darf NICHT geloescht sein").toBe(200);
  } finally {
    await deleteFreeAccount(foreign);
  }

  // Aufraeumen ueber den Happy Path — belegt zugleich, dass nach einem
  // fehlgeschlagenen Batch ein korrekter Batch normal funktioniert.
  const cleanup = await bulkDelete([a, b]);
  expect(cleanup.status).toBe(200);
  expect((await listShiftsOf("active")).length).toBe(0);
});

test("bucht beim Sammel-Loeschen von Urlaub das Urlaubskonto wie Einzel-Loeschungen zurueck", async () => {
  // Einzel-Pfade mit Urlaubskonto-Fortschreibung dauern mehrere Sekunden pro Tag.
  test.setTimeout(120_000);
  const days = [dayString("06-15"), dayString("06-16"), dayString("06-17")];

  const baseline = await vacationHoursUsed();

  // Sammel-Anlage -> Konto belastet.
  const bulkIds = await bulkAbsence("vacation", days);
  const deltaCreate = (await vacationHoursUsed()) - baseline;
  expect(deltaCreate, "Anlage muss Urlaubsstunden buchen").toBeGreaterThan(0);

  // Sammel-Loeschen -> Konto exakt zurueck auf den Ausgangswert.
  const { status } = await bulkDelete(bulkIds);
  expect(status).toBe(200);
  expect(await vacationHoursUsed(), "Sammel-Loeschen muss exakt zurueckbuchen").toBeCloseTo(
    baseline,
    2,
  );
  expect((await listShiftsOf("vacation")).length).toBe(0);

  // Referenz: dieselben Tage einzeln loeschen muss auf demselben Stand enden.
  const singleIds = await bulkAbsence("vacation", days);
  expect((await vacationHoursUsed()) - baseline, "Wieder-Anlage identisch").toBeCloseTo(
    deltaCreate,
    2,
  );
  for (const id of singleIds) {
    const res = await adminCtx.delete(`/api/shifts/${id}`);
    expect(res.ok(), `DELETE /api/shifts/${id} fehlgeschlagen`).toBe(true);
  }
  expect(await vacationHoursUsed(), "Einzel-Loeschungen als Referenz").toBeCloseTo(baseline, 2);
  expect((await listShiftsOf("vacation")).length).toBe(0);
});

test("loescht die automatisch gebuchte Zeiterfassung der Abwesenheiten mit", async () => {
  const shiftIds = await bulkAbsence("sick", [dayString("10-20"), dayString("10-21")]);
  const idSet = new Set(shiftIds);

  const before = await adminCtx.get(`/api/time-tracking?userId=${assistantId}`);
  expect(before.ok(), "GET /api/time-tracking fehlgeschlagen").toBe(true);
  const entriesBefore = ((await before.json()) as TimeEntry[]).filter(
    (e) => e.shiftId != null && idSet.has(e.shiftId),
  );
  expect(entriesBefore.length, "Abwesenheiten muessen Ist-Zeiten buchen").toBe(2);

  const { status } = await bulkDelete(shiftIds);
  expect(status).toBe(200);

  const after = await adminCtx.get(`/api/time-tracking?userId=${assistantId}`);
  expect(after.ok(), "GET /api/time-tracking (danach) fehlgeschlagen").toBe(true);
  const entriesAfter = ((await after.json()) as TimeEntry[]).filter(
    (e) => e.shiftId != null && idSet.has(e.shiftId),
  );
  expect(entriesAfter.length, "Keine verwaisten Ist-Zeiten nach Sammel-Loeschen").toBe(0);
});
