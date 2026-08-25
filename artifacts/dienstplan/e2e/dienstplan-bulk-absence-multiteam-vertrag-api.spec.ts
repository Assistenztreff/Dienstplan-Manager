import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * Vertrags-Auswahl bei Verträgen in MEHREREN Teams (Task #757).
 *
 * Der Sammel-Endpunkt löst die Tages-Soll-Stunden und den zu belastenden
 * Urlaubsvertrag aus einer einmalig geladenen Vertragsliste auf, statt pro Tag
 * `activeContractFor` abzufragen. `activeContractFor` wählt den aktiven
 * Vertrag mit dem JÜNGSTEN Beginn OHNE Team-Filter — existiert also ein
 * neuerer aktiver Vertrag in einem anderen Team, greift der Einzelpfad auf
 * diesen zu.
 *
 * Dieses Spec fixiert, dass der Sammelauftrag exakt dieselbe Auswahl trifft:
 * Andernfalls würden Zeiterfassung, gewertete Stunden oder der
 * Urlaubskonto-Abzug auf einem anderen Vertrag landen als beim Einzel-Anlegen
 * — ein Lohn-/Urlaubskonto-Fehler, den kein Typecheck sieht.
 *
 * Aufbau: eine Assistenzkraft, Mitglied in Team A und Team B, mit ZWEI
 * gleichzeitig aktiven Verträgen unterschiedlicher Wochenstunden. Der Vertrag
 * in Team B beginnt SPÄTER und gewinnt damit die (ungescopte) Auswahl.
 */

// Anker statt Fixjahr: Vertrag A beginnt auf "heute + 1 Monat, Tag 1"; alle
// weiteren Daten sind Monats-Offsets ab diesem Anker (nicht ein fixer
// Kalendermonat). Das haelt Reihenfolge (A vor B vor den Abwesenheitstagen)
// UND Gesamtzeitraum dauerhaft innerhalb des 12-Monats-Limits, unabhaengig
// vom realen Laufmonat (s. .agents/memory/e2e-absence-date-anchor-pattern.md).
const ANCHOR = new Date();
ANCHOR.setUTCMonth(ANCHOR.getUTCMonth() + 1, 1);
ANCHOR.setUTCHours(0, 0, 0, 0);

function monthOffset(monthsAfterAnchor: number, day: number): string {
  const d = new Date(ANCHOR);
  d.setUTCMonth(d.getUTCMonth() + monthsAfterAnchor, day);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Der frühere Vertrag liegt in Team A, der jüngere in Team B — die Tage der
// Abwesenheit liegen im Überschneidungszeitraum, beide sind also aktiv.
const CONTRACT_A_START = monthOffset(0, 1);
const CONTRACT_B_START = monthOffset(2, 1);
const DAYS = [monthOffset(5, 2), monthOffset(5, 3), monthOffset(5, 4)];

type Shift = {
  id: number;
  userId: number;
  startTime: string;
  valuedHours?: number | null;
};
type TimeEntry = { shiftId: number | null; actualHours: number | null };
type VacationBalance = { vacationHoursUsed?: number | null };

let h: TeamTestHarness;
let teamA: number;
let teamB: number;
let assistantId: number;
let contractA: number;
let contractB: number;

function fullDay(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

async function vacationShifts(): Promise<Shift[]> {
  const res = await h.ctx.get(`/api/shifts?type=vacation&userId=${assistantId}&teamId=${teamA}`);
  expect(res.ok(), `GET /api/shifts fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Shift[])
    .filter((s) => s.userId === assistantId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

async function trackedHours(): Promise<Map<number, number>> {
  const res = await h.ctx.get(`/api/time-tracking?userId=${assistantId}&teamId=${teamA}`);
  expect(res.ok(), `GET /api/time-tracking fehlgeschlagen (${res.status()})`).toBe(true);
  const map = new Map<number, number>();
  for (const e of (await res.json()) as TimeEntry[]) {
    if (e.shiftId != null) map.set(e.shiftId, e.actualHours ?? 0);
  }
  return map;
}

async function usedVacationHours(contractId: number): Promise<number> {
  const res = await h.ctx.get(`/api/contracts/${contractId}/vacation-balance`);
  expect(res.ok(), `GET vacation-balance ${contractId} fehlgeschlagen (${res.status()})`).toBe(true);
  return Number(((await res.json()) as VacationBalance).vacationHoursUsed ?? 0);
}

async function snapshot(): Promise<{
  valued: number[];
  tracked: number[];
  usedA: number;
  usedB: number;
}> {
  const shifts = await vacationShifts();
  const hours = await trackedHours();
  return {
    valued: shifts.map((s) => s.valuedHours ?? 0),
    tracked: shifts.map((s) => hours.get(s.id) ?? 0),
    usedA: await usedVacationHours(contractA),
    usedB: await usedVacationHours(contractB),
  };
}

async function removeVacationShifts(): Promise<void> {
  for (const s of await vacationShifts()) {
    const res = await h.ctx.delete(`/api/shifts/${s.id}`);
    expect(res.ok(), `DELETE /api/shifts/${s.id} fehlgeschlagen`).toBe(true);
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  teamA = await h.createTeam(`Bulk Vertrag A ${h.run}`);
  teamB = await h.createTeam(`Bulk Vertrag B ${h.run}`);

  assistantId = await h.createUser({ teamId: teamA, role: "assistant" });
  // Zweite Mitgliedschaft: dieselbe Person arbeitet auch in Team B.
  const memberRes = await h.ctx.post(`/api/teams/${teamB}/members`, {
    data: { userId: assistantId },
  });
  expect(
    memberRes.ok(),
    `Mitgliedschaft in Team B fehlgeschlagen (${memberRes.status()})`,
  ).toBe(true);

  // Zwei gleichzeitig aktive Verträge mit UNTERSCHIEDLICHEN Wochenstunden —
  // damit die Tages-Soll-Stunden je nach gewähltem Vertrag messbar abweichen
  // (20/5 = 4 h gegenüber 40/5 = 8 h).
  contractA = await h.createContract(teamA, assistantId, {
    startDate: CONTRACT_A_START,
    weeklyHours: 40,
    vacationDays: 30,
  });
  contractB = await h.createContract(teamB, assistantId, {
    startDate: CONTRACT_B_START,
    weeklyHours: 20,
    vacationDays: 30,
  });
});

test.afterAll(async () => {
  await h.cleanup();
});

test("Sammelauftrag waehlt bei Vertraegen in zwei Teams denselben Vertrag wie die Einzel-Anlage", async () => {
  test.setTimeout(180_000);

  // A) Sammelauftrag über Team A, obwohl der jüngere Vertrag in Team B liegt.
  const bulkRes = await h.ctx.post("/api/shifts/bulk-absence", {
    data: {
      userId: assistantId,
      teamId: teamA,
      type: "vacation",
      days: DAYS.map(fullDay),
    },
  });
  expect(bulkRes.status(), "Sammelauftrag sollte 201 liefern").toBe(201);
  expect(((await bulkRes.json()) as { createdCount: number }).createdCount).toBe(DAYS.length);

  const bulk = await snapshot();
  await removeVacationShifts();

  // Urlaubskonto nach dem Löschen wieder auf dem Ausgangswert — sonst
  // vergleicht der zweite Durchgang gegen einen verschobenen Nullpunkt.
  const afterDelete = { usedA: await usedVacationHours(contractA), usedB: await usedVacationHours(contractB) };

  // B) Dieselben Tage einzeln über Team A.
  for (const day of DAYS) {
    const res = await h.ctx.post("/api/shifts", {
      data: { userId: assistantId, teamId: teamA, type: "vacation", ...fullDay(day) },
    });
    expect(res.status(), `Einzel-Anlage ${day} sollte 201 liefern`).toBe(201);
  }
  const single = await snapshot();
  await removeVacationShifts();

  console.log(
    `[bulk-multiteam] bulk=${JSON.stringify(bulk)} nachLoeschen=${JSON.stringify(afterDelete)} single=${JSON.stringify(single)}`,
  );

  // Gewertete Stunden und Zeiterfassung je Tag identisch.
  for (let i = 0; i < DAYS.length; i++) {
    expect(bulk.valued[i], `valuedHours Tag ${i + 1}`).toBeCloseTo(single.valued[i]!, 2);
    expect(bulk.tracked[i], `Zeiterfassung Tag ${i + 1}`).toBeCloseTo(single.tracked[i]!, 2);
  }

  // Entscheidend: DERSELBE Vertrag wird belastet. Ein Auseinanderlaufen hier
  // hiesse, dass der Sammelweg das Urlaubskonto eines anderen Teams abbucht.
  expect(bulk.usedA, "Urlaubsverbrauch Vertrag Team A").toBeCloseTo(single.usedA, 2);
  expect(bulk.usedB, "Urlaubsverbrauch Vertrag Team B").toBeCloseTo(single.usedB, 2);

  // Gegenprobe: Es wurde ueberhaupt Urlaub verbucht (sonst waere die
  // Gleichheit oben trivial erfuellt).
  const bulkTotal = bulk.usedA + bulk.usedB;
  const baselineTotal = afterDelete.usedA + afterDelete.usedB;
  expect(bulkTotal, "Sammelauftrag muss Urlaub verbucht haben").toBeGreaterThan(baselineTotal);
});
