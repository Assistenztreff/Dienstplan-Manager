import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Regressionsschutz Mehrfach-Dienst-Fall (Task: kein Doppel-Soll am Urlaubstag):
 *
 * findPlannedWorkShiftsForDay liefert ALLE geplanten Arbeitsdienste des Tages
 * (laengster zuerst). Beim Anlegen einer Abwesenheit erbt diese die Zeiten des
 * LAENGSTEN Dienstes, aber ALLE Dienste des Tages werden geloescht
 * (Lohnausfallprinzip, deleteReplacedWorkShift-Schleife in POST /api/shifts).
 *
 * Bliebe ein zweiter Dienst stehen (z. B. bei einem geteilten Dienst
 * vormittags + abends), entstuende STILLES Doppel-Soll in der Lohnbilanz:
 * Die geerbte Abwesenheit zaehlt zum Soll UND der uebrig gebliebene Dienst
 * ebenfalls — die Bilanz wuerde faelschlich negativ.
 *
 * Szenario: zwei NICHT ueberlappende FIX-Dienste unterschiedlicher Laenge am
 * selben Tag (langer Vormittagsdienst + kurzer Abenddienst), dann ganztaegiger
 * Urlaub. Assertions:
 *  - BEIDE Dienste sind nach dem Urlaub geloescht (404).
 *  - Die Abwesenheit traegt exakt die Zeiten des LAENGEREN Dienstes.
 *  - hours-balance-Soll entspricht NUR den geerbten Stunden (kein Doppel-Soll),
 *    Bilanz = 0.
 *
 * Fester Monat (Oktober des Vertragsjahres, Mittwoch im Fenster 10.–16.10. —
 * kein Sonntag, keine bundesweiten Feiertage); Tageszeiten ohne Nachtanteil,
 * Zuschlaege sind hier nicht Testgegenstand. Der Setup-Admin ist premium
 * (hours-balance ist Premium-gegated, Vorausplanung unbegrenzt).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

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

// Geteilter Dienst: langer Vormittagsblock (6 h) + kurzer Abendblock (3 h),
// bewusst NICHT ueberlappend (keine force-Umgehung der Kollisionspruefung
// noetig) und ohne Nachtfenster-Anteil (23–06 Uhr).
function isoAt(hour: number): string {
  return new Date(`${SHIFT_DAY}T${String(hour).padStart(2, "0")}:00:00`).toISOString();
}
const LONG_SHIFT = { startTime: isoAt(8), endTime: isoAt(14) }; // 6 h
const SHORT_SHIFT = { startTime: isoAt(18), endTime: isoAt(21) }; // 3 h

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
  startTime: string;
  endTime: string;
  planningStatus?: string | null;
  valuedHours?: number | null;
};
type BalanceRow = {
  userId: number;
  plannedHours: number;
  balance: number;
  totalFulfilledHours: number;
  vacationFulfilledHours: number;
  vacationDaysTaken: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const hoursBetween = (startIso: string, endIso: string) =>
  (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;
let longShiftId: number;
let shortShiftId: number;
let longShiftStored: Shift;
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

async function createFixShift(times: { startTime: string; endTime: string }): Promise<number> {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "active",
      planningStatus: "FIX",
      ...times,
    },
  });
  expect(res.status(), `Dienst anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  return ((await res.json()) as Shift).id;
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
      name: `E2E MehrfachDienst ${unique}`,
      email: `e2e.mehrfachdienst.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as CreatedUser).id;

  // Vertrag ab Jahresbeginn: noetig fuer die Urlaubs-Buchhaltung
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
  // Falls der Ersetzungs-Test scheiterte, koennen die Dienste noch existieren.
  if (!vacationShiftId) {
    if (longShiftId) await adminCtx.delete(`/api/shifts/${longShiftId}`);
    if (shortShiftId) await adminCtx.delete(`/api/shifts/${shortShiftId}`);
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test("Zwei FIX-Dienste unterschiedlicher Laenge am selben Tag zaehlen beide zum Soll", async () => {
  // Bewusst den KURZEN zuerst anlegen: die Erbfolge muss aus der Dauer-
  // Sortierung kommen, nicht aus der Insert-Reihenfolge.
  shortShiftId = await createFixShift(SHORT_SHIFT);
  longShiftId = await createFixShift(LONG_SHIFT);

  longShiftStored = await fetchShift(longShiftId);
  expect(longShiftStored.planningStatus, "Dienst muss FIX sein").toBe("FIX");

  const expectedTotal = round2(
    hoursBetween(LONG_SHIFT.startTime, LONG_SHIFT.endTime) +
      hoursBetween(SHORT_SHIFT.startTime, SHORT_SHIFT.endTime)
  );
  const row = await fetchBalanceRow();
  expect(row.plannedHours, "Beide Dienste muessen im Soll stehen").toBe(expectedTotal);
  expect(row.vacationFulfilledHours).toBe(0);
});

test("Urlaub loescht BEIDE Dienste und erbt die Zeiten des LAENGEREN", async () => {
  expect(longShiftId && shortShiftId, "Dienste aus vorherigem Test fehlen").toBeTruthy();

  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "vacation",
      ...fullDayTimes(SHIFT_DAY),
    },
  });
  expect(res.status(), `Urlaub anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  vacationShiftId = ((await res.json()) as Shift).id;

  // Kern der Regression: BEIDE Dienste sind geloescht — bliebe der zweite
  // stehen, entstuende stilles Doppel-Soll.
  const longGone = await adminCtx.get(`/api/shifts/${longShiftId}`);
  expect(longGone.status(), "Langer Dienst muss geloescht sein").toBe(404);
  const shortGone = await adminCtx.get(`/api/shifts/${shortShiftId}`);
  expect(shortGone.status(), "Kurzer Dienst muss geloescht sein").toBe(404);

  // Die Abwesenheit erbt exakt die Zeiten des LAENGEREN Dienstes (Round-Trip
  // ueber die DB) — nicht die des kurzen und nicht die ganztaegigen Zeiten.
  const stored = await fetchShift(vacationShiftId);
  expect(new Date(stored.startTime).toISOString()).toBe(
    new Date(longShiftStored.startTime).toISOString()
  );
  expect(new Date(stored.endTime).toISOString()).toBe(
    new Date(longShiftStored.endTime).toISOString()
  );
});

test("Bilanz ohne Doppel-Soll: Soll = nur geerbte Stunden, Bilanz 0", async () => {
  expect(vacationShiftId, "Urlaubsschicht aus vorherigem Test fehlt").toBeTruthy();

  const stored = await fetchShift(vacationShiftId);
  const inheritedHours = round2(hoursBetween(stored.startTime, stored.endTime));
  const fulfilledHours = round2(stored.valuedHours ?? 0);
  expect(inheritedHours, "Geerbte Stunden muessen > 0 sein").toBeGreaterThan(0);
  // Geerbt wurde die Dauer des LANGEN Dienstes (6 h), nicht die Summe beider.
  expect(inheritedHours).toBe(
    round2(hoursBetween(LONG_SHIFT.startTime, LONG_SHIFT.endTime))
  );
  expect(fulfilledHours, "valuedHours muss den geerbten Stunden entsprechen").toBe(
    inheritedHours
  );

  const row = await fetchBalanceRow();

  // Soll = NUR die geerbten Stunden der Abwesenheit. Waere ein Dienst uebrig
  // geblieben, laege das Soll um dessen Stunden hoeher (Doppel-Soll).
  expect(row.plannedHours, "Soll darf nur die geerbten Stunden enthalten").toBe(
    inheritedHours
  );

  // Erfuellt: Lohnfortzahlung der Abwesenheit.
  expect(row.vacationFulfilledHours).toBe(fulfilledHours);
  expect(row.totalFulfilledHours).toBe(fulfilledHours);
  expect(row.vacationDaysTaken).toBe(1);

  // Bilanz NEUTRAL (Soll = Ist der Lohnfortzahlung, kein Doppel-Soll).
  expect(row.balance, "Bilanz muss neutral (0) bleiben").toBe(0);
});
