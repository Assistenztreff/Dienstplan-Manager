import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Paritaet des Sammel-Endpunkts fuer ALLE unterstuetzten Abwesenheitsarten
 * (Task #757).
 *
 * Der Sammelauftrag berechnet die Stunden inzwischen vorab und fuegt Schichten
 * und Zeiterfassungen gebuendelt ein, statt pro Tag die alte Kette aus
 * storeShiftMetrics/bookAbsenceTimeTracking zu durchlaufen. Fuer die bezahlten
 * Arten (Urlaub/Krank) ist das bereits abgesichert — hier wird jede Art des
 * Sammel-Endpunkts gegen die Einzel-Anlage geprueft, insbesondere die
 * UNBEZAHLTEN Kategorien (kind_krank, abgesagt_an), die keine Zuschlaege
 * tragen duerfen.
 *
 * Verglichen werden die gespeicherten Kennzahlen (valuedHours, nightHours,
 * sundayHours, holidayHours) und die gebuchte Zeiterfassung (actualHours).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const YEAR = new Date().getFullYear();

// Alle Arten, die BulkCreateAbsenceBody zulaesst.
const ABSENCE_TYPES = [
  "vacation",
  "sick",
  "freizeitausgleich",
  "kind_krank",
  "freistellung",
  "abgesagt_ag",
  "abgesagt_an",
  "urlaubsabgeltung",
] as const;

type Shift = {
  id: number;
  userId: number;
  type: string;
  startTime: string;
  endTime: string;
  valuedHours?: number | null;
  nightHours?: number | null;
  sundayHours?: number | null;
  holidayHours?: number | null;
};
type TimeEntry = { shiftId: number | null; actualHours: number | null };

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;

function fullDay(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

async function shiftsOfType(type: string): Promise<Shift[]> {
  const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
  expect(res.ok(), `GET /api/shifts (${type}) fehlgeschlagen`).toBe(true);
  return ((await res.json()) as Shift[])
    .filter((s) => s.userId === assistantId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

async function hoursByShiftId(): Promise<Map<number, number>> {
  const res = await adminCtx.get(`/api/time-tracking?userId=${assistantId}`);
  expect(res.ok(), "GET /api/time-tracking fehlgeschlagen").toBe(true);
  const map = new Map<number, number>();
  for (const entry of (await res.json()) as TimeEntry[]) {
    if (entry.shiftId != null) map.set(entry.shiftId, entry.actualHours ?? 0);
  }
  return map;
}

async function removeShifts(shifts: Shift[]): Promise<void> {
  for (const shift of shifts) {
    const res = await adminCtx.delete(`/api/shifts/${shift.id}`);
    expect(res.ok(), `DELETE /api/shifts/${shift.id} fehlgeschlagen`).toBe(true);
  }
}

test.beforeAll(async () => {
  test.setTimeout(60_000);
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const login = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(login.ok(), "Admin-Login fehlgeschlagen").toBe(true);

  const unique = Date.now();
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Bulk Typen ${unique}`,
      email: `e2e.bulk.typen.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen der Assistenzkraft fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as { id: number }).id;

  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistantId,
      startDate: `${YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(true);
  contractId = ((await contractRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  for (const type of ABSENCE_TYPES) {
    const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${assistantId}`);
    if (res.ok()) {
      for (const s of ((await res.json()) as Shift[]).filter((s) => s.userId === assistantId)) {
        await adminCtx.delete(`/api/shifts/${s.id}`);
      }
    }
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

for (const [index, type] of ABSENCE_TYPES.entries()) {
  test(`Sammelauftrag und Einzel-Anlage sind identisch fuer ${type}`, async () => {
    test.setTimeout(120_000);

    // Je Art ein eigener, kollisionsfreier Zeitraum aus 3 Tagen.
    const month = String(index + 2).padStart(2, "0");
    const range = [`${YEAR}-${month}-04`, `${YEAR}-${month}-05`, `${YEAR}-${month}-06`];

    // A) Sammelauftrag
    const bulkRes = await adminCtx.post("/api/shifts/bulk-absence", {
      data: { userId: assistantId, type, days: range.map(fullDay) },
    });
    expect(bulkRes.status(), `Sammelauftrag (${type}) sollte 201 liefern`).toBe(201);
    expect(((await bulkRes.json()) as { createdCount: number }).createdCount).toBe(3);

    const bulkShifts = await shiftsOfType(type);
    const bulkHours = await hoursByShiftId();
    expect(bulkShifts).toHaveLength(3);
    const bulkSnapshot = bulkShifts.map((s) => ({
      valued: s.valuedHours ?? 0,
      night: s.nightHours ?? 0,
      sunday: s.sundayHours ?? 0,
      holiday: s.holidayHours ?? 0,
      tracked: bulkHours.get(s.id) ?? 0,
    }));
    await removeShifts(bulkShifts);

    // B) Dieselben Tage einzeln (Referenzverhalten)
    for (const day of range) {
      const res = await adminCtx.post("/api/shifts", {
        data: { userId: assistantId, type, ...fullDay(day) },
      });
      expect(res.status(), `Einzel-Anlage ${type} ${day} sollte 201 liefern`).toBe(201);
    }
    const singleShifts = await shiftsOfType(type);
    const singleHours = await hoursByShiftId();
    expect(singleShifts).toHaveLength(3);
    const singleSnapshot = singleShifts.map((s) => ({
      valued: s.valuedHours ?? 0,
      night: s.nightHours ?? 0,
      sunday: s.sundayHours ?? 0,
      holiday: s.holidayHours ?? 0,
      tracked: singleHours.get(s.id) ?? 0,
    }));
    await removeShifts(singleShifts);

    console.log(
      `[bulk-typen] ${type}: bulk=${JSON.stringify(bulkSnapshot[0])} single=${JSON.stringify(singleSnapshot[0])}`,
    );

    for (let i = 0; i < 3; i++) {
      expect(bulkSnapshot[i]!.valued, `${type}: valuedHours Tag ${i + 1}`).toBeCloseTo(
        singleSnapshot[i]!.valued,
        2,
      );
      expect(bulkSnapshot[i]!.night, `${type}: nightHours Tag ${i + 1}`).toBeCloseTo(
        singleSnapshot[i]!.night,
        2,
      );
      expect(bulkSnapshot[i]!.sunday, `${type}: sundayHours Tag ${i + 1}`).toBeCloseTo(
        singleSnapshot[i]!.sunday,
        2,
      );
      expect(bulkSnapshot[i]!.holiday, `${type}: holidayHours Tag ${i + 1}`).toBeCloseTo(
        singleSnapshot[i]!.holiday,
        2,
      );
      expect(bulkSnapshot[i]!.tracked, `${type}: Zeiterfassung Tag ${i + 1}`).toBeCloseTo(
        singleSnapshot[i]!.tracked,
        2,
      );
    }
  });
}
