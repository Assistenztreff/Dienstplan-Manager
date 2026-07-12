import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Regressionsschutz: Eine Abwesenheit (Urlaub), die einen bereits GEPLANTEN
 * Dienst am selben Tag ersetzt, haelt die Lohn-Bilanz neutral
 * (Lohnausfallprinzip, Primary-Lookup in POST /api/shifts):
 *
 * - Der geplante FIX-Arbeitsdienst wird beim Anlegen der Abwesenheit GELOESCHT
 *   (deleteReplacedWorkShift) — sonst stuende er doppelt im Soll.
 * - Die Abwesenheit ERBT die exakten Start-/Endzeiten des ersetzten Dienstes
 *   (findPlannedWorkShiftsForDay) statt der ganztaegigen 00:00–23:59-Zeiten.
 * - GET /dashboard/hours-balance: Die geerbte Abwesenheit zaehlt wie der
 *   ersetzte Dienst zum SOLL (inheritedAbsenceHours), die Lohnfortzahlung
 *   (valuedHours) erfuellt genau dieses Soll — Bilanz = 0.
 * - Zuschlagsfortzahlung: Deckte der ersetzte Dienst Nachtstunden ab, werden
 *   dessen Nacht-Zuschlagsstunden an der Abwesenheit fortgefuehrt (die
 *   Kennzahlen liegen an der Abwesenheits-Schicht gespeichert).
 *
 * Dieser Pfad war bisher nur manuell geprueft; eine Regression wuerde
 * Lohn-Bilanzen still verzerren (z. B. Doppel-Soll oder verlorene Zuschlaege).
 *
 * Erwartungswerte werden aus den GESPEICHERTEN Kennzahlen der Schichten
 * (GET /api/shifts/:id) abgeleitet — keine Duplikation der Stunden-/
 * Zuschlagsberechnung. Fester Monat (Oktober des Vertragsjahres, Werktag
 * per Wochentags-Suche — kein Sonntag, keine bundesweiten Feiertage im
 * Fenster 10.–16.10.); der Setup-Admin ist premium (hours-balance ist
 * Premium-gegated, Vorausplanung unbegrenzt).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Vertragsjahr = aktuelles Jahr (Vertrag ab 01.01.), Auswertungsmonat fest:
// Oktober. Der Diensttag wird als Mittwoch im Fenster 10.–16.10. gesucht,
// damit weder der Dienst (Start) noch sein Folgetag (Nachtdienst-Ende) auf
// einen Sonntag oder bundesweiten Feiertag (03.10.) faellt — die
// Sonntags-/Feiertagslogik ist hier nicht Testgegenstand, nur die
// NACHT-Zuschlagsfortzahlung.
const YEAR = new Date().getFullYear();
const MONTH = 10;

function findWednesday(): string {
  for (let day = 10; day <= 16; day++) {
    const d = new Date(`${YEAR}-10-${String(day).padStart(2, "0")}T12:00:00`);
    if (d.getDay() === 3) return `${YEAR}-10-${String(day).padStart(2, "0")}`;
  }
  throw new Error("Kein Mittwoch im Fenster 10.-16.10. gefunden");
}
const SHIFT_DAY = findWednesday();

// Nachtdienst 20:00–06:00 (Folgetag): liegt sicher im Standard-Nachtfenster
// (23–06 Uhr), traegt also Nachtstunden fuer die Zuschlagsfortzahlung.
function nightShiftTimes(): { startTime: string; endTime: string } {
  const start = new Date(`${SHIFT_DAY}T20:00:00`);
  const end = new Date(start.getTime() + 10 * 3_600_000);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

// Ganztaegige Abwesenheit, exakt wie das Frontend sie sendet (00:00–23:59).
function fullDayTimes(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

type CreatedUser = { id: number };
type Shift = {
  id: number;
  userId: number;
  type: string;
  startTime: string;
  endTime: string;
  planningStatus?: string | null;
  valuedHours?: number | null;
  nightHours?: number | null;
  sundayHours?: number | null;
  holidayHours?: number | null;
};
type BalanceRow = {
  userId: number;
  plannedHours: number;
  balance: number;
  totalFulfilledHours: number;
  vacationFulfilledHours: number;
  vacationDaysTaken: number;
  nightHours: number;
  nightSurchargeHours: number;
  nightPercent: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const hoursBetween = (startIso: string, endIso: string) =>
  (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;
let workShiftId: number;
let workShiftStored: Shift;
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

  // Frischer Assistent im Standard-Team des Admins (teamId weggelassen ->
  // resolveWriteTeamId-Fallback), damit keine Stoerdaten anderer Specs die
  // Bilanz-Zeile beeinflussen.
  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E ErsetzterDienst ${unique}`,
      email: `e2e.ersatzdienst.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as CreatedUser).id;

  // Vertrag 40h/Woche ab Jahresbeginn: noetig fuer die Urlaubs-Buchhaltung
  // (vacationHoursUsed) beim Anlegen des Urlaubs.
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
  // Falls der Ersetzungs-Test scheiterte, kann der Arbeitsdienst noch existieren.
  if (workShiftId && !vacationShiftId) await adminCtx.delete(`/api/shifts/${workShiftId}`);
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test("Geplanter FIX-Nachtdienst traegt gewertete Stunden und Nachtstunden", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      ...nightShiftTimes(),
    },
  });
  expect(res.status(), `Dienst anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  workShiftId = ((await res.json()) as Shift).id;

  workShiftStored = await fetchShift(workShiftId);
  expect(workShiftStored.planningStatus, "Dienst muss FIX sein").toBe("FIX");
  expect(workShiftStored.valuedHours ?? 0, "Dienst muss gewertete Stunden tragen").toBeGreaterThan(0);
  // Nachtanteil (Standard-Nachtfenster 23–06 Uhr) ist Voraussetzung fuer den
  // Zuschlagsfortzahlungs-Teil des Tests.
  expect(workShiftStored.nightHours ?? 0, "Dienst muss Nachtstunden tragen").toBeGreaterThan(0);

  // Vorher-Bild der Bilanz: Der FIX-Dienst zaehlt zum Soll; in der Standard-
  // Abrechnungsart SOLL gelten seine gewerteten Stunden zugleich als erfuellt
  // (kein Urlaub gebucht). Wichtig fuer spaeter: genau EIN Soll-Posten.
  const row = await fetchBalanceRow();
  expect(row.plannedHours).toBe(
    round2(hoursBetween(workShiftStored.startTime, workShiftStored.endTime))
  );
  expect(row.vacationFulfilledHours).toBe(0);
  expect(row.totalFulfilledHours).toBe(round2(workShiftStored.valuedHours ?? 0));
});

test("Urlaub am Diensttag ersetzt den Dienst und erbt dessen exakte Zeiten", async () => {
  expect(workShiftId, "Arbeitsdienst aus vorherigem Test fehlt").toBeTruthy();

  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "vacation",
      ...fullDayTimes(SHIFT_DAY),
    },
  });
  expect(res.status(), `Urlaub anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  const created = (await res.json()) as Shift;
  vacationShiftId = created.id;

  // Der ersetzte Arbeitsdienst ist GELOESCHT (kein Doppel-Soll) ...
  const goneRes = await adminCtx.get(`/api/shifts/${workShiftId}`);
  expect(goneRes.status(), "Ersetzter Dienst muss geloescht sein").toBe(404);

  // ... und die Abwesenheit hat NICHT die ganztaegigen 00:00–23:59-Zeiten,
  // sondern die exakten Zeiten des ersetzten Dienstes geerbt (Round-Trip
  // ueber die DB, kein Response-Schoenfaerben).
  const stored = await fetchShift(vacationShiftId);
  expect(new Date(stored.startTime).toISOString()).toBe(
    new Date(workShiftStored.startTime).toISOString()
  );
  expect(new Date(stored.endTime).toISOString()).toBe(
    new Date(workShiftStored.endTime).toISOString()
  );

  // Zuschlagsfortzahlung: Die Nachtstunden des ersetzten Dienstes leben an der
  // Abwesenheit weiter (identisches Zeitfenster -> identische Nachtstunden).
  expect(stored.nightHours, "Nachtstunden muessen fortgefuehrt werden").toBe(
    workShiftStored.nightHours
  );
  expect(stored.nightHours ?? 0).toBeGreaterThan(0);
});

test("Bilanz bleibt neutral: Soll = geerbte Stunden, erfuellt = Lohnfortzahlung, Bilanz 0", async () => {
  expect(vacationShiftId, "Urlaubsschicht aus vorherigem Test fehlt").toBeTruthy();

  const stored = await fetchShift(vacationShiftId);
  const inheritedHours = round2(hoursBetween(stored.startTime, stored.endTime));
  const fulfilledHours = round2(stored.valuedHours ?? 0);
  expect(inheritedHours, "Geerbte Stunden muessen > 0 sein").toBeGreaterThan(0);
  // Lohnfortzahlung erfuellt exakt das geerbte Soll (Lohnausfallprinzip).
  expect(fulfilledHours, "valuedHours muss den geerbten Stunden entsprechen").toBe(inheritedHours);

  const row = await fetchBalanceRow();

  // Soll: Die geerbte Abwesenheit zaehlt wie der ersetzte Dienst zum Plan.
  // Der Dienst selbst ist geloescht — es darf KEIN Doppel-Soll entstehen.
  expect(row.plannedHours, "Soll muss den geerbten Stunden entsprechen").toBe(inheritedHours);

  // Erfuellt: Lohnfortzahlung der Abwesenheit.
  expect(row.vacationFulfilledHours).toBe(fulfilledHours);
  expect(row.totalFulfilledHours).toBe(fulfilledHours);
  expect(row.vacationDaysTaken).toBe(1);

  // Kern des Tests: Bilanz NEUTRAL (Soll = Ist der Lohnfortzahlung).
  expect(row.balance, "Bilanz muss neutral (0) bleiben").toBe(0);

  // Zuschlagsfortzahlung in der Auswertung: Die Nachtstunden der Abwesenheit
  // erscheinen als Nacht- und Nacht-Zuschlagsstunden (Satz aus den
  // angewandten Konto-Einstellungen der Zeile — keine Duplikation der Kette).
  const nightHours = round2(stored.nightHours ?? 0);
  expect(row.nightHours, "Nachtstunden fehlen in der Auswertung").toBe(nightHours);
  expect(row.nightSurchargeHours, "Nacht-Zuschlagsstunden fehlen").toBe(
    round2((nightHours * row.nightPercent) / 100)
  );
});
