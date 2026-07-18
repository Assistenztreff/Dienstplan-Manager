import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-E2E-Beweis: Urlaubs-Fallback ueber Vertragsstunden (bwavg-Methode).
 *
 * Bewertungskette fuer einen GANZTAEGIGEN Urlaubstag bei Methode bwavg:
 *   1. Vertragsbeginn >= 13 Wochen vor dem Urlaubstag UND bestaetigte
 *      Arbeits-IST-Historie im Fenster -> 13-Wochen-Schnitt (wie bisher).
 *   2. Sonst, aktiver team-gescopter Vertrag -> Wochenstunden / Arbeitstage
 *      pro Woche (neues Vertragsfeld workdaysPerWeek, Default 5).
 *   3. Sonst (kein Vertrag) -> Pauschalwert "Stunden pro Urlaubstag" (8h).
 *
 * Fixture-Werte sind bewusst unterscheidbar: Vertrag 35h / 7 Arbeitstage
 * -> 5h/Tag (Kette 2), Historie 2 Tage x 10h -> Schnitt 10h/Tag (Kette 1),
 * Pauschale 8h (Kette 3). Ein falscher Zweig faellt sofort auf.
 *
 * Beobachtet wird der Urlaubszaehler des Vertrags (vacationHoursUsed nach
 * dem Anlegen des Urlaubs) bzw. fuer den vertragslosen Fall die gebuchte
 * Lohnfortzahlungs-IST-Zeit (actualHours des Abwesenheits-Zeiteintrags).
 *
 * Grenzfall: Vertragsbeginn EXAKT 91 Tage (13 Wochen) vor dem Urlaubstag
 * zaehlt bereits als ">= 13 Wochen" -> mit Historie gilt der Schnitt.
 */

const DAY_MS = 24 * 3_600_000;

// Lokale Kalendertage relativ zu heute (Mitternacht), wie das Frontend sie
// sendet.
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

const VACATION_DAY = dayStr(0);

let h: TeamTestHarness;
let teamId: number;

async function fetchVacationHoursUsed(contractId: number): Promise<number> {
  const res = await h.ctx.get(`/api/contracts/${contractId}`);
  expect(res.ok(), `GET /api/contracts/${contractId} fehlgeschlagen (${res.status()})`).toBe(true);
  const body = (await res.json()) as { vacationHoursUsed?: number };
  return body.vacationHoursUsed ?? 0;
}

async function createVacation(userId: number): Promise<number> {
  const res = await h.ctx.post("/api/shifts", {
    data: {
      userId,
      teamId,
      type: "vacation",
      ...fullDayTimes(VACATION_DAY),
    },
  });
  expect(res.status(), `Urlaub anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

// Bestaetigte Arbeits-IST-Historie: Arbeitsdienst (type work) + verknuepfter
// Zeiteintrag, danach bestaetigt (nur bestaetigte IST an work-Schichten
// zaehlen fuer den 13-Wochen-Schnitt).
async function seedConfirmedWorkDay(
  userId: number,
  day: string,
  hours: number
): Promise<void> {
  const start = new Date(`${day}T08:00:00`);
  const end = new Date(start.getTime() + hours * 3_600_000);
  const shiftRes = await h.ctx.post("/api/shifts", {
    data: {
      userId,
      teamId,
      type: "work",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
  });
  expect(shiftRes.ok(), `Arbeitsdienst anlegen fehlgeschlagen (${shiftRes.status()})`).toBe(true);
  const shiftId = ((await shiftRes.json()) as { id: number }).id;

  const ttRes = await h.ctx.post("/api/time-tracking", {
    data: {
      userId,
      teamId,
      shiftId,
      actualStart: start.toISOString(),
      actualEnd: end.toISOString(),
    },
  });
  expect(ttRes.ok(), `Ist-Zeit anlegen fehlgeschlagen (${ttRes.status()})`).toBe(true);
  const entryId = ((await ttRes.json()) as { id: number }).id;

  const confirmRes = await h.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
    data: { status: "confirmed", confirmedBy: h.adminId },
  });
  expect(confirmRes.ok(), `Ist-Zeit bestaetigen fehlgeschlagen (${confirmRes.status()})`).toBe(true);
}

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  // Frisches Premium-Dienstleister-Konto: eigenes Team ohne Stoerdaten,
  // Standard-Einstellungen (bwavg, 8h/Urlaubstag), Premium fuer das
  // Bestaetigen der IST-Historie.
  await h.becomeDienstleister();
  teamId = await h.createTeam(`E2E UrlaubFallback ${h.run}`);
});

test.afterAll(async () => {
  await h.cleanup();
});

test("Neuer Vertrag ohne Historie: Urlaubstag = Wochenstunden / Arbeitstage", async () => {
  const userId = await h.createUser({ teamId });
  const contractRes = await h.ctx.post("/api/contracts", {
    data: {
      userId,
      teamId,
      weeklyHours: 35,
      workdaysPerWeek: 7,
      vacationDays: 30,
      startDate: dayStr(-28), // 4 Wochen alt -> kein 13-Wochen-Schnitt moeglich
    },
  });
  expect(contractRes.ok(), `Vertrag anlegen fehlgeschlagen (${contractRes.status()})`).toBe(true);
  const contract = (await contractRes.json()) as { id: number; workdaysPerWeek?: number };
  // Contract-Roundtrip: das neue Feld wird gespeichert und ausgeliefert.
  expect(contract.workdaysPerWeek, "workdaysPerWeek fehlt in der Antwort").toBe(7);

  await createVacation(userId);
  // 35h / 7 Arbeitstage = 5h — NICHT die Pauschale (8h).
  expect(await fetchVacationHoursUsed(contract.id)).toBe(5);
});

test("Alter Vertrag (>= 13 Wochen) OHNE Historie: weiterhin Vertragswert", async () => {
  const userId = await h.createUser({ teamId });
  const contractRes = await h.ctx.post("/api/contracts", {
    data: {
      userId,
      teamId,
      weeklyHours: 35,
      workdaysPerWeek: 7,
      vacationDays: 30,
      startDate: dayStr(-140), // 20 Wochen alt, aber keine bestaetigte IST
    },
  });
  expect(contractRes.ok()).toBe(true);
  const contract = (await contractRes.json()) as { id: number };

  await createVacation(userId);
  expect(await fetchVacationHoursUsed(contract.id)).toBe(5);
});

test("Grenzfall exakt 13 Wochen + Historie: 13-Wochen-Schnitt gilt", async () => {
  const userId = await h.createUser({ teamId });
  const contractRes = await h.ctx.post("/api/contracts", {
    data: {
      userId,
      teamId,
      weeklyHours: 35,
      workdaysPerWeek: 7,
      vacationDays: 30,
      startDate: dayStr(-91), // exakt 13 Wochen vor dem Urlaubstag
    },
  });
  expect(contractRes.ok()).toBe(true);
  const contract = (await contractRes.json()) as { id: number };

  // Historie im Fenster: 2 Arbeitstage x 10h -> Schnitt 10h/Tag.
  await seedConfirmedWorkDay(userId, dayStr(-14), 10);
  await seedConfirmedWorkDay(userId, dayStr(-7), 10);

  await createVacation(userId);
  // Schnitt (10h) schlaegt Vertragswert (5h) und Pauschale (8h).
  expect(await fetchVacationHoursUsed(contract.id)).toBe(10);
});

test("Ohne Vertrag: Pauschale 'Stunden pro Urlaubstag' (8h)", async () => {
  const userId = await h.createUser({ teamId });

  const vacationId = await createVacation(userId);

  // Kein Vertrag -> kein Urlaubszaehler; beobachtbar ist die gebuchte
  // Lohnfortzahlungs-IST-Zeit der Abwesenheit (Pauschale 8h).
  const listRes = await h.ctx.get(`/api/time-tracking?userId=${userId}&teamId=${teamId}`);
  expect(listRes.ok(), `GET /api/time-tracking fehlgeschlagen (${listRes.status()})`).toBe(true);
  const entries = (await listRes.json()) as { shiftId?: number | null; actualHours: number }[];
  const entry = entries.find((e) => e.shiftId === vacationId);
  expect(entry, "Abwesenheits-Zeiteintrag fehlt").toBeTruthy();
  expect(entry!.actualHours).toBe(8);
});
