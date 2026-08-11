import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * Vertragsänderung parallel zu einem laufenden Sammelauftrag (Task #757).
 *
 * Der Sammel-Endpunkt liest den Vertragsbestand EINMAL — und zwar innerhalb
 * derselben Transaktion, die anschließend Schichten, Zeiterfassung und
 * Urlaubskonto schreibt. Damit arbeiten Vertrags-Guard, Tages-Soll-Stunden und
 * Urlaubskonto-Buchung garantiert auf EINEM konsistenten Vertragsstand.
 *
 * Dieses Spec fixiert genau diese Eigenschaft: Läuft parallel eine
 * Vertragsänderung, muss das Ergebnis EIN kohärenter Stand sein — entweder
 * durchgängig der alte oder durchgängig der neue Vertrag. Ein Mischergebnis
 * (einzelne Tage nach altem, andere nach neuem Vertrag) wäre ein Lohn- und
 * Urlaubskonto-Fehler und entstünde, sobald jemand wieder pro Tag liest.
 *
 * Bewusst KEINE Prüfung auf einen bestimmten der beiden Stände: welcher
 * gewinnt, hängt vom Timing ab. Geprüft wird die Kohärenz.
 */

const YEAR = new Date().getFullYear();
const DAYS = [
  `${YEAR}-09-01`,
  `${YEAR}-09-02`,
  `${YEAR}-09-03`,
  `${YEAR}-09-04`,
  `${YEAR}-09-05`,
  `${YEAR}-09-08`,
];

type Shift = {
  id: number;
  userId: number;
  startTime: string;
  valuedHours?: number | null;
};
type TimeEntry = { shiftId: number | null; actualHours: number | null };

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

test.beforeAll(async () => {
  test.setTimeout(120_000);
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();
  teamId = await h.createTeam(`Bulk Vertragsaenderung ${h.run}`);
  assistantId = await h.createUser({ teamId, role: "assistant" });
  contractId = await h.createContract(teamId, assistantId, {
    startDate: `${YEAR}-01-01`,
    weeklyHours: 40,
    vacationDays: 30,
  });
});

test.afterAll(async () => {
  await h.cleanup();
});

test("Vertragsaenderung waehrend eines Sammelauftrags ergibt einen kohaerenten Vertragsstand", async () => {
  test.setTimeout(180_000);

  // Sammelauftrag und Vertragsänderung GLEICHZEITIG abschicken. Die Änderung
  // halbiert die Wochenstunden (40 -> 20), die Tages-Soll-Stunden fallen damit
  // von 8 h auf 4 h — ein Mischergebnis waere also deutlich sichtbar.
  const [bulkRes, patchRes] = await Promise.all([
    h.ctx.post("/api/shifts/bulk-absence", {
      data: { userId: assistantId, teamId, type: "vacation", days: DAYS.map(fullDay) },
    }),
    h.ctx.patch(`/api/contracts/${contractId}`, {
      data: { weeklyHours: 20 },
    }),
  ]);

  expect(bulkRes.status(), "Sammelauftrag sollte 201 liefern").toBe(201);
  expect(patchRes.ok(), `Vertragsaenderung fehlgeschlagen (${patchRes.status()})`).toBe(true);
  expect(((await bulkRes.json()) as { createdCount: number }).createdCount).toBe(DAYS.length);

  const shiftsRes = await h.ctx.get(`/api/shifts?type=vacation&userId=${assistantId}&teamId=${teamId}`);
  expect(shiftsRes.ok(), `GET /api/shifts fehlgeschlagen (${shiftsRes.status()})`).toBe(true);
  const shifts = ((await shiftsRes.json()) as Shift[])
    .filter((s) => s.userId === assistantId)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  expect(shifts, "Alle Tage muessen angelegt sein").toHaveLength(DAYS.length);

  const trackingRes = await h.ctx.get(`/api/time-tracking?userId=${assistantId}&teamId=${teamId}`);
  expect(trackingRes.ok(), `GET /api/time-tracking fehlgeschlagen (${trackingRes.status()})`).toBe(true);
  const tracked = new Map<number, number>();
  for (const e of (await trackingRes.json()) as TimeEntry[]) {
    if (e.shiftId != null) tracked.set(e.shiftId, e.actualHours ?? 0);
  }

  const valued = shifts.map((s) => s.valuedHours ?? 0);
  const actual = shifts.map((s) => tracked.get(s.id) ?? 0);
  console.log(`[bulk-vertragsaenderung] valued=${JSON.stringify(valued)} tracked=${JSON.stringify(actual)}`);

  // KERN: alle Tage folgen demselben Vertragsstand. Der Sammelauftrag liest die
  // Vertraege einmal in der schreibenden Transaktion — ein Wechsel mitten im
  // Zeitraum darf nicht entstehen.
  const uniqueValued = [...new Set(valued.map((v) => Math.round(v * 100)))];
  expect(
    uniqueValued,
    `Alle Tage muessen denselben Vertragsstand nutzen, waren aber: ${JSON.stringify(valued)}`,
  ).toHaveLength(1);

  const uniqueTracked = [...new Set(actual.map((v) => Math.round(v * 100)))];
  expect(
    uniqueTracked,
    `Zeiterfassung muss demselben Vertragsstand folgen, war aber: ${JSON.stringify(actual)}`,
  ).toHaveLength(1);

  // Der kohaerente Stand ist einer der beiden gueltigen (8 h alt / 4 h neu) —
  // kein dritter Wert aus einer Teilberechnung.
  expect([800, 400], `Unerwarteter Tageswert: ${valued[0]}`).toContain(uniqueValued[0]);
  // Zeiterfassung und gewertete Stunden gehoeren zum selben Stand.
  expect(uniqueTracked[0], "Zeiterfassung und gewertete Stunden muessen zusammenpassen").toBe(
    uniqueValued[0],
  );
});
