import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-E2E-Beweis: Die Tages-Soll-Stunden einer Abwesenheit (dailyTargetHours,
 * Lohnfortzahlungs-Buchung) leiten sich aus dem Vertragsfeld
 * 'Arbeitstage pro Woche' ab — nicht mehr fest aus Wochenstunden / 5.
 *
 * Beobachtet wird die gebuchte Lohnfortzahlungs-IST-Zeit (actualHours des
 * Abwesenheits-Zeiteintrags) bei Urlaubsmethode 'factor': dort ist der
 * Tageswert exakt das dailyTargetHours-Fallback (kein bwavg-Zweig, der die
 * gleiche Division selbst nochmal rechnet).
 *
 * Fixture-Werte bewusst unterscheidbar:
 *   Vertrag 35h / 7 Arbeitstage -> 5h/Tag  (alter Code: 35/5 = 7h)
 *   Vertrag 30h / 3 Arbeitstage -> 10h/Tag (alter Code: 30/5 = 6h)
 * Ein Rueckfall auf die feste 5-Tage-Division faellt sofort auf.
 */

const DAY_MS = 24 * 3_600_000;

function dayStr(offsetDays: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(today.getTime() + offsetDays * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Ganztaegige Abwesenheit, exakt wie das Frontend sie sendet (00:00-23:59).
function fullDayTimes(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

let h: TeamTestHarness;
let teamId: number;

async function createContract(
  userId: number,
  weeklyHours: number,
  workdaysPerWeek: number
): Promise<void> {
  const res = await h.ctx.post("/api/contracts", {
    data: {
      userId,
      teamId,
      weeklyHours,
      workdaysPerWeek,
      vacationDays: 30,
      startDate: dayStr(-28),
    },
  });
  expect(res.ok(), `Vertrag anlegen fehlgeschlagen (${res.status()})`).toBe(true);
}

async function createAbsence(
  userId: number,
  type: "vacation" | "sick",
  day: string
): Promise<number> {
  const res = await h.ctx.post("/api/shifts", {
    data: { userId, teamId, type, ...fullDayTimes(day) },
  });
  expect(res.status(), `Abwesenheit anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function bookedHoursFor(userId: number, shiftId: number): Promise<number> {
  const res = await h.ctx.get(`/api/time-tracking?userId=${userId}&teamId=${teamId}`);
  expect(res.ok(), `GET /api/time-tracking fehlgeschlagen (${res.status()})`).toBe(true);
  const entries = (await res.json()) as { shiftId?: number | null; actualHours: number }[];
  const entry = entries.find((e) => e.shiftId === shiftId);
  expect(entry, "Lohnfortzahlungs-Zeiteintrag der Abwesenheit fehlt").toBeTruthy();
  return entry!.actualHours;
}

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  // Frisches Premium-Dienstleister-Konto ohne Stoerdaten.
  await h.becomeDienstleister();
  // Urlaubsmethode 'factor': der Tageswert der Abwesenheits-Buchung ist dann
  // exakt das Soll-Stunden-Fallback (dailyTargetHours) — der Prueffokus.
  const getRes = await h.ctx.get("/api/allowance-settings");
  expect(getRes.ok(), `Einstellungen laden fehlgeschlagen (${getRes.status()})`).toBe(true);
  const settings = (await getRes.json()) as {
    nightPercent: number;
    nightStart: string;
    nightEnd: string;
    sundayPercent: number;
    holidayPercent: number;
  };
  const putRes = await h.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: settings.nightPercent,
      nightStart: settings.nightStart,
      nightEnd: settings.nightEnd,
      sundayPercent: settings.sundayPercent,
      holidayPercent: settings.holidayPercent,
      vacationMethod: "factor",
    },
  });
  expect(putRes.ok(), `Urlaubsmethode setzen fehlgeschlagen (${putRes.status()})`).toBe(true);
  teamId = await h.createTeam(`E2E SollWorkdays ${h.run}`);
});

test.afterAll(async () => {
  await h.cleanup();
});

test("Urlaubstag: Soll-Stunden = Wochenstunden / Arbeitstage (35h/7 -> 5h)", async () => {
  const userId = await h.createUser({ teamId });
  await createContract(userId, 35, 7);
  const shiftId = await createAbsence(userId, "vacation", dayStr(0));
  // 35h / 7 Arbeitstage = 5h — NICHT 35/5 = 7h (alte feste Division).
  expect(await bookedHoursFor(userId, shiftId)).toBe(5);
});

test("Krankheitstag: Soll-Stunden folgen ebenfalls den Arbeitstagen (30h/3 -> 10h)", async () => {
  const userId = await h.createUser({ teamId });
  await createContract(userId, 30, 3);
  const shiftId = await createAbsence(userId, "sick", dayStr(0));
  // 30h / 3 Arbeitstage = 10h — NICHT 30/5 = 6h.
  expect(await bookedHoursFor(userId, shiftId)).toBe(10);
});

test("Ohne Vertrag: Fallback bleibt 8h", async () => {
  const userId = await h.createUser({ teamId });
  const shiftId = await createAbsence(userId, "vacation", dayStr(0));
  expect(await bookedHoursFor(userId, shiftId)).toBe(8);
});
