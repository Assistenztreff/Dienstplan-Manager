import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * §11-BUrlG-Durchschnitt (bwavg) bei ERSETZTEN Diensten im Sammelauftrag
 * (Task #757).
 *
 * Der Durchschnitt speist sich aus BESTÄTIGTEN Arbeits-Ist-Zeiten der letzten
 * 13 Wochen. Ersetzt eine Abwesenheit einen geplanten Dienst, verschwindet
 * dessen Ist-Zeit — und beeinflusst damit den Durchschnitt SPÄTERER Tage
 * desselben Zeitraums.
 *
 * Der Einzelpfad löscht den ersetzten Dienst, BEVOR er die Kennzahlen der
 * Abwesenheit berechnet (deleteReplacedWorkShift vor storeShiftMetrics). Bei
 * N Einzel-Requests ist der Dienst von Tag 1 also bereits weg, wenn Tag 2
 * seinen Durchschnitt bildet. Der Sammelauftrag muss dieselbe Reihenfolge
 * einhalten — würde er erst rechnen und dann löschen, zählte der ersetzte
 * Dienst noch mit und Tag 2 bekäme einen höheren Durchschnitt als beim
 * Einzel-Anlegen.
 *
 * Aufbau (Zahlen so gewählt, dass der Unterschied eindeutig messbar ist):
 *  • Vorgeschichte: 3 Arbeitstage à 6 h bestätigt  -> Durchschnitt 6,0 h
 *  • Tag 1 der Abwesenheit: geplanter Dienst à 12 h, ebenfalls bestätigt.
 *    Zählte er noch mit, wäre der Durchschnitt (18+12)/4 = 7,5 h.
 *  • Tag 2 der Abwesenheit: leerer Tag -> ganztägig -> nutzt den Durchschnitt.
 * Tag 2 muss also 6,0 h bekommen, nicht 7,5 h.
 */

const YEAR = new Date().getFullYear();
const CONTRACT_START = `${YEAR - 1}-01-01`; // > 13 Wochen alt -> bwavg greift
const HISTORY_DAYS = [`${YEAR}-05-04`, `${YEAR}-05-05`, `${YEAR}-05-06`];
const DAY_WITH_SHIFT = `${YEAR}-06-01`; // Dienst wird von der Abwesenheit ersetzt
const DAY_EMPTY = `${YEAR}-06-02`; // ganztägig -> Durchschnitt entscheidet
const ABSENCE_DAYS = [DAY_WITH_SHIFT, DAY_EMPTY];

const CONTRACT_DAILY_HOURS = 8; // 40 Wochenstunden / 5 Arbeitstage

type Shift = { id: number; userId: number; startTime: string; valuedHours?: number | null };
type TimeEntry = { shiftId: number | null; actualHours: number | null };
type VacationBalance = { vacationHoursUsed?: number | null };

let h: TeamTestHarness;
let teamId: number;
let assistantId: number;
let contractId: number;

function fullDay(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

/** Arbeitsdienst plus bestätigte Ist-Zeit — nur so zählt der Tag im Durchschnitt. */
async function seedConfirmedWork(day: string, hours: number): Promise<number> {
  const start = `${day}T08:00:00.000Z`;
  const end = `${day}T${String(8 + hours).padStart(2, "0")}:00:00.000Z`;
  const shiftRes = await h.ctx.post("/api/shifts", {
    data: { userId: assistantId, teamId, type: "work", startTime: start, endTime: end },
  });
  expect(shiftRes.ok(), `Arbeitsdienst ${day} fehlgeschlagen (${shiftRes.status()})`).toBe(true);
  const shiftId = ((await shiftRes.json()) as { id: number }).id;

  const ttRes = await h.ctx.post("/api/time-tracking", {
    data: { userId: assistantId, teamId, shiftId, actualStart: start, actualEnd: end },
  });
  expect(ttRes.ok(), `Ist-Zeit ${day} fehlgeschlagen (${ttRes.status()})`).toBe(true);
  return shiftId;
}

async function vacationShifts(): Promise<Shift[]> {
  const res = await h.ctx.get(`/api/shifts?type=vacation&userId=${assistantId}&teamId=${teamId}`);
  expect(res.ok(), `GET /api/shifts fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Shift[])
    .filter((s) => s.userId === assistantId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

async function usedVacationHours(): Promise<number> {
  const res = await h.ctx.get(`/api/contracts/${contractId}/vacation-balance`);
  expect(res.ok(), `GET vacation-balance fehlgeschlagen (${res.status()})`).toBe(true);
  return Number(((await res.json()) as VacationBalance).vacationHoursUsed ?? 0);
}

async function snapshot(): Promise<{ valued: number[]; tracked: number[]; used: number }> {
  const shifts = await vacationShifts();
  const ttRes = await h.ctx.get(`/api/time-tracking?userId=${assistantId}&teamId=${teamId}`);
  expect(ttRes.ok(), `GET /api/time-tracking fehlgeschlagen (${ttRes.status()})`).toBe(true);
  const byShift = new Map<number, number>();
  for (const e of (await ttRes.json()) as TimeEntry[]) {
    if (e.shiftId != null) byShift.set(e.shiftId, e.actualHours ?? 0);
  }
  return {
    valued: shifts.map((s) => s.valuedHours ?? 0),
    tracked: shifts.map((s) => byShift.get(s.id) ?? 0),
    used: await usedVacationHours(),
  };
}

async function removeVacationShifts(): Promise<void> {
  for (const s of await vacationShifts()) {
    const res = await h.ctx.delete(`/api/shifts/${s.id}`);
    expect(res.ok(), `DELETE /api/shifts/${s.id} fehlgeschlagen`).toBe(true);
  }
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();
  teamId = await h.createTeam(`Bulk bwavg ${h.run}`);
  assistantId = await h.createUser({ teamId, role: "assistant" });
  contractId = await h.createContract(teamId, assistantId, {
    startDate: CONTRACT_START,
    weeklyHours: 40,
    vacationDays: 30,
  });

  // Zeiterfassung an und bwavg als Legacy-Einstellung fixieren. Die bestätigte
  // IST-Historie darf die Bewertung eines Urlaubstags trotzdem nicht verändern.
  const getRes = await h.ctx.get("/api/allowance-settings");
  expect(getRes.ok(), `Einstellungen lesen fehlgeschlagen (${getRes.status()})`).toBe(true);
  const s = (await getRes.json()) as {
    nightPercent: number;
    nightStart: string;
    nightEnd: string;
    sundayPercent: number;
    holidayPercent: number;
  };
  const putRes = await h.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: s.nightPercent,
      nightStart: s.nightStart,
      nightEnd: s.nightEnd,
      sundayPercent: s.sundayPercent,
      holidayPercent: s.holidayPercent,
      timeTrackingEnabled: true,
      autoApproveTimesheets: true,
      vacationMethod: "bwavg",
    },
  });
  expect(putRes.ok(), `Einstellungen setzen fehlgeschlagen (${putRes.status()})`).toBe(true);

  for (const day of HISTORY_DAYS) await seedConfirmedWork(day, 6);
});

test.afterAll(async () => {
  await h.cleanup();
});

test("Sammelauftrag nutzt wie die Einzel-Anlage die typische Vertrags-Dienstlänge", async () => {
  test.setTimeout(240_000);

  // A) Sammelauftrag: Tag 1 ersetzt einen 12-h-Dienst, Tag 2 ist leer.
  await seedConfirmedWork(DAY_WITH_SHIFT, 12);
  const bulkRes = await h.ctx.post("/api/shifts/bulk-absence", {
    data: {
      userId: assistantId,
      teamId,
      type: "vacation",
      days: ABSENCE_DAYS.map(fullDay),
    },
  });
  expect(bulkRes.status(), "Sammelauftrag sollte 201 liefern").toBe(201);
  expect(((await bulkRes.json()) as { createdCount: number }).createdCount).toBe(
    ABSENCE_DAYS.length,
  );
  const bulk = await snapshot();
  await removeVacationShifts();
  const usedAfterBulkCleanup = await usedVacationHours();

  // B) Dieselbe Ausgangslage, aber Tag für Tag angelegt.
  await seedConfirmedWork(DAY_WITH_SHIFT, 12);
  for (const day of ABSENCE_DAYS) {
    const res = await h.ctx.post("/api/shifts", {
      data: { userId: assistantId, teamId, type: "vacation", ...fullDay(day) },
    });
    expect(res.status(), `Einzel-Anlage ${day} sollte 201 liefern`).toBe(201);
  }
  const single = await snapshot();
  await removeVacationShifts();

  console.log(
    `[bulk-bwavg] bulk=${JSON.stringify(bulk)} single=${JSON.stringify(single)} nachCleanup=${usedAfterBulkCleanup}`,
  );

  // KERN: Sammelweg und Einzelweg liefern identische Werte.
  expect(bulk.valued, "Gewertete Stunden je Tag muessen identisch sein").toEqual(single.valued);
  expect(bulk.tracked, "Zeiterfassung je Tag muss identisch sein").toEqual(single.tracked);
  expect(bulk.used, "Urlaubskonto-Abzug muss identisch sein").toBeCloseTo(single.used, 2);

  // Die IST-Historie und der ersetzte Dienst dürfen den vollen Urlaubstag
  // nicht beeinflussen: ohne konkreten Dienst gilt die Vertrags-Dienstlänge.
  const day2Bulk = bulk.valued[1] ?? 0;
  expect(day2Bulk, `Tag 2 sollte ${CONTRACT_DAILY_HOURS} h nutzen`).toBeCloseTo(
    CONTRACT_DAILY_HOURS,
    2,
  );
});
