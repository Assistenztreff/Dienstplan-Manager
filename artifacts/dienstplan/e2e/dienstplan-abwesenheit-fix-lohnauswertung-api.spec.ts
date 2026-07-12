import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Regressionsschutz: Abwesenheiten (Urlaub/Krankheit) sind IMMER verbindlich
 * (FIX) und fliessen dadurch in die Lohnauswertung ein — unabhaengig davon,
 * ueber welchen Weg sie angelegt wurden.
 *
 * Hintergrund: Der Kalender-Schicht-Dialog legt neue Eintraege standardmaessig
 * als Entwurf (planningStatus VORLAEUFIG) an. Fuer Abwesenheiten waere das eine
 * Sackgasse: Nur FIX-Schichten zaehlen in GET /dashboard/hours-balance, und die
 * Kalender-Sammelbestaetigung schliesst Abwesenheiten bewusst aus — eine
 * vorlaeufige Abwesenheit fiele also STILL aus den Auswertungen (genau der
 * behobene Bug). Der Server setzt den Status deshalb bei POST und PATCH
 * autoritativ auf FIX. Dieser Test sichert das Verhalten direkt gegen die API:
 *
 * - POST /api/shifts (Urlaub/Krank) mit planningStatus VORLAEUFIG (der
 *   Kalender-Dialog-Pfad) -> Response UND frischer GET liefern FIX.
 * - PATCH kann eine Abwesenheit NICHT auf VORLAEUFIG/ANGEBOTEN zuruecksetzen
 *   (Request gelingt, Status bleibt FIX — Round-Trip ueber die DB geprueft).
 * - Die erfuellten Stunden der Abwesenheit erscheinen in
 *   GET /dashboard/hours-balance: vacationFulfilledHours/sickHours,
 *   totalFulfilledHours (erfuellte Gesamtstunden) und balance (Bilanz).
 *
 * Erwartungswerte werden aus den GESPEICHERTEN valuedHours der Schichten
 * (GET /api/shifts/:id) abgeleitet — keine Duplikation der Stunden-Berechnung.
 * Fester Monat (September des Vertragsjahres), damit keine "aktueller
 * Monat"-Flakes entstehen; der Setup-Admin ist premium (hours-balance ist
 * Premium-gegated, Vorausplanung unbegrenzt).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Vertragsjahr = aktuelles Jahr (Vertrag ab 01.01.), Auswertungsmonat fest:
// September, zwei Werktage (Di 15. = Urlaub, Mi 16. = Krank; keine bundesweiten
// Feiertage, keine Sonntage — die Zuschlagslogik ist hier nicht Testgegenstand).
const YEAR = new Date().getFullYear();
const MONTH = 9;
const VACATION_DAY = `${YEAR}-09-15`;
const SICK_DAY = `${YEAR}-09-16`;

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
  planningStatus?: string | null;
  valuedHours?: number | null;
};
type BalanceRow = {
  userId: number;
  plannedHours: number;
  balance: number;
  totalFulfilledHours: number;
  vacationFulfilledHours: number;
  sickHours: number;
  vacationDaysTaken: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;
let vacationShiftId: number;
let sickShiftId: number;

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
      name: `E2E AbwesenheitFix ${unique}`,
      email: `e2e.abwfix.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as CreatedUser).id;

  // Vertrag 40h/Woche ab Jahresbeginn: liefert die vertraglichen Tages-Soll-
  // Stunden, mit denen eine ganztaegige Abwesenheit bewertet wird.
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
  if (sickShiftId) await adminCtx.delete(`/api/shifts/${sickShiftId}`);
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test("Urlaub via Kalender-Dialog-Pfad (planningStatus VORLAEUFIG) wird serverseitig FIX", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "vacation",
      planningStatus: "VORLAEUFIG",
      ...fullDayTimes(VACATION_DAY),
    },
  });
  expect(res.status(), `Urlaub anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  const created = (await res.json()) as Shift;
  vacationShiftId = created.id;

  // Response ist bereits FIX ...
  expect(created.planningStatus, "Response muss FIX liefern").toBe("FIX");
  // ... und der Round-Trip ueber die DB bestaetigt es (kein Response-Schoenfaerben).
  const stored = await fetchShift(vacationShiftId);
  expect(stored.planningStatus, "Gespeicherter Status muss FIX sein").toBe("FIX");
});

test("Krankmeldung mit planningStatus VORLAEUFIG wird ebenfalls serverseitig FIX", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "sick",
      planningStatus: "VORLAEUFIG",
      ...fullDayTimes(SICK_DAY),
    },
  });
  expect(res.status(), `Krank anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  const created = (await res.json()) as Shift;
  sickShiftId = created.id;

  expect(created.planningStatus).toBe("FIX");
  expect((await fetchShift(sickShiftId)).planningStatus).toBe("FIX");
});

test("PATCH kann eine Abwesenheit nicht auf VORLAEUFIG oder ANGEBOTEN zuruecksetzen", async () => {
  expect(vacationShiftId, "Urlaubsschicht aus vorherigem Test fehlt").toBeTruthy();

  for (const attempted of ["VORLAEUFIG", "ANGEBOTEN"] as const) {
    const res = await adminCtx.patch(`/api/shifts/${vacationShiftId}`, {
      data: { planningStatus: attempted },
    });
    // Der Request selbst gelingt (kein Fehler fuer den Client) ...
    expect(res.ok(), `PATCH (${attempted}) fehlgeschlagen (${res.status()})`).toBe(true);
    // ... aber der Server ueberschreibt autoritativ: gespeichert bleibt FIX.
    const stored = await fetchShift(vacationShiftId);
    expect(
      stored.planningStatus,
      `Abwesenheit darf nicht auf ${attempted} zurueckfallen`
    ).toBe("FIX");
  }
});

test("Erfuellte Stunden der Abwesenheiten erscheinen in der Lohnauswertung (hours-balance)", async () => {
  expect(vacationShiftId && sickShiftId, "Abwesenheiten aus vorherigen Tests fehlen").toBeTruthy();

  // Erwartung aus den GESPEICHERTEN Kennzahlen ableiten: valuedHours der
  // ganztaegigen Abwesenheit = vertragliche Tages-Soll-Stunden (40h/5 = 8h).
  const vacationStored = await fetchShift(vacationShiftId);
  const sickStored = await fetchShift(sickShiftId);
  const vacationHours = vacationStored.valuedHours ?? 0;
  const sickHours = sickStored.valuedHours ?? 0;
  expect(vacationHours, "Urlaub muss gewertete Stunden tragen").toBeGreaterThan(0);
  expect(sickHours, "Krankheit muss gewertete Stunden tragen").toBeGreaterThan(0);

  const row = await fetchBalanceRow();

  // Nur die beiden Abwesenheiten existieren fuer diesen frischen Assistenten
  // im Auswertungsmonat — die Zeile ist also exakt vorhersagbar. Wuerde eine
  // Abwesenheit doch wieder als VORLAEUFIG gespeichert (der behobene Bug),
  // fiele sie hier still auf 0.
  expect(row.vacationFulfilledHours, "Urlaubsstunden fehlen in der Auswertung").toBe(
    round2(vacationHours)
  );
  expect(row.sickHours, "Krankstunden fehlen in der Auswertung").toBe(round2(sickHours));
  expect(row.vacationDaysTaken).toBe(1);

  // Erfuellte Gesamtstunden = Urlaub + Krank (keine Arbeitsschichten angelegt).
  expect(row.totalFulfilledHours, "Erfuellte Gesamtstunden falsch").toBe(
    round2(vacationHours + sickHours)
  );

  // Bilanz = erfuellt - geplant. Ganztaegige Abwesenheiten ohne ersetzten
  // Dienst zaehlen nicht zum Soll, also plannedHours 0 und Bilanz positiv.
  expect(row.plannedHours).toBe(0);
  expect(row.balance, "Bilanz muss die Abwesenheitsstunden enthalten").toBe(
    round2(vacationHours + sickHours)
  );
});
