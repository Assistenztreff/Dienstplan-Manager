import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Regressionsschutz fuer den DRITTEN Abwesenheits-Zeitpfad (Fallback-Zweig in
 * POST /api/shifts): Wird eine Abwesenheit (Urlaub) auf einem LEEREN Tag mit
 * verknuepftem Schichtmodell (shiftModelId) angelegt, leitet der Server die
 * Start-/Endzeiten aus den Modell-Standardzeiten ab (shiftModelTimesForDay):
 *
 * - Die ganztaegigen Frontend-Zeiten (00:00–23:59) werden durch die
 *   Modell-Standardzeiten ERSETZT; liegt das Modell-Ende vor oder gleich dem
 *   Start (Nachtdienst), endet die Abwesenheit am FOLGETAG.
 * - Diese abgeleiteten Zeiten steuern Soll-Anrechnung und
 *   Zuschlagsfortzahlung genau wie beim ersetzten Dienst: Die Abwesenheit
 *   zaehlt mit den Modellstunden zum Soll (inheritedAbsenceHours), die
 *   Lohnfortzahlung (valuedHours) erfuellt exakt dieses Soll — Bilanz = 0.
 * - Nacht-Standardzeiten (22:00–06:00) erzeugen Nachtstunden an der
 *   Abwesenheit, die als Nacht-/Nacht-Zuschlagsstunden fortgefuehrt werden.
 *
 * Eine Regression wuerde still ganztaegige 00:00–23:59-Eintraege OHNE
 * Zuschlaege erzeugen (kein Soll-Beitrag, keine Zuschlagsfortzahlung).
 *
 * Erwartungswerte werden aus den GESPEICHERTEN Kennzahlen der Abwesenheit
 * (GET /api/shifts/:id) abgeleitet — keine Duplikation der Stunden-/
 * Zuschlagsberechnung. Fester Monat (Oktober des Vertragsjahres, Mittwoch im
 * Fenster 10.–16.10. — weder Starttag noch Folgetag ist Sonntag oder
 * bundesweiter Feiertag); der Setup-Admin ist premium (hours-balance ist
 * Premium-gegated).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const YEAR = new Date().getFullYear();
const MONTH = 10;

// Modell-Standardzeiten: Nachtdienst ueber Mitternacht (Ende <= Start), damit
// sowohl der Folgetag-Fall als auch die Nachtstunden-Fortzahlung geprueft wird.
const MODEL_START = "22:00";
const MODEL_END = "06:00";

function findWednesday(): string {
  for (let day = 10; day <= 16; day++) {
    const d = new Date(`${YEAR}-10-${String(day).padStart(2, "0")}T12:00:00Z`);
    if (d.getUTCDay() === 3) return `${YEAR}-10-${String(day).padStart(2, "0")}`;
  }
  throw new Error("Kein Mittwoch im Fenster 10.-16.10. gefunden");
}
const ABSENCE_DAY = findWednesday();
const NEXT_DAY = new Date(
  new Date(`${ABSENCE_DAY}T00:00:00Z`).getTime() + 24 * 3_600_000
)
  .toISOString()
  .split("T")[0]!;

// Ganztaegige Abwesenheit, exakt wie das Frontend sie sendet (00:00–23:59).
// Bewusst als UTC-ISO, damit die serverseitige Tages-Ableitung
// (toISOString-basiert in shiftModelTimesForDay) deterministisch ABSENCE_DAY
// trifft, unabhaengig von der Server-Zeitzone.
function fullDayTimes(day: string): { startTime: string; endTime: string } {
  return {
    startTime: `${day}T00:00:00.000Z`,
    endTime: `${day}T23:59:59.000Z`,
  };
}

type Shift = {
  id: number;
  startTime: string;
  endTime: string;
  planningStatus?: string | null;
  shiftModelId?: number | null;
  valuedHours?: number | null;
  nightHours?: number | null;
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
let shiftModelId: number;
let vacationShiftId: number;
let vacationStored: Shift;

async function fetchShift(id: number): Promise<Shift> {
  const res = await adminCtx.get(`/api/shifts/${id}`);
  expect(res.ok(), `GET /api/shifts/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Shift;
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
      name: `E2E ModellUrlaub ${unique}`,
      email: `e2e.modellurlaub.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as { id: number }).id;

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

  // Eigenes Schichtmodell mit Nacht-Standardzeiten (die Test-DB seedet keine
  // Standard-Modelle; der Setup-Admin ist premium, kein maxShiftModels-Limit).
  const modelRes = await adminCtx.post("/api/shift-models", {
    data: {
      name: `E2E Nachtmodell ${unique}`,
      defaultStartTime: MODEL_START,
      defaultEndTime: MODEL_END,
    },
  });
  expect(modelRes.status(), `Schichtmodell anlegen sollte 201 liefern (${modelRes.status()})`).toBe(201);
  shiftModelId = ((await modelRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (vacationShiftId) await adminCtx.delete(`/api/shifts/${vacationShiftId}`);
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  // Soft-Delete des Modells, damit es keinen Slot im Admin-Team belegt.
  if (shiftModelId) await adminCtx.delete(`/api/shift-models/${shiftModelId}`);
  await adminCtx.dispose();
});

test("Urlaub auf leerem Tag mit Schichtmodell erbt die Modellzeiten (Ende am Folgetag)", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "vacation",
      shiftModelId,
      ...fullDayTimes(ABSENCE_DAY),
    },
  });
  expect(res.status(), `Urlaub anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  vacationShiftId = ((await res.json()) as Shift).id;

  // Round-Trip ueber die DB (kein Response-Schoenfaerben): Die Abwesenheit
  // traegt NICHT die ganztaegigen 00:00–23:59-Zeiten, sondern exakt die
  // Modell-Standardzeiten — Start am Abwesenheitstag, Ende am FOLGETAG
  // (Ueber-Mitternacht-Fall, Ende <= Start).
  vacationStored = await fetchShift(vacationShiftId);
  expect(new Date(vacationStored.startTime).toISOString()).toBe(
    `${ABSENCE_DAY}T${MODEL_START}:00.000Z`
  );
  expect(new Date(vacationStored.endTime).toISOString()).toBe(
    `${NEXT_DAY}T${MODEL_END}:00.000Z`
  );

  // Abwesenheiten sind serverseitig immer verbindlich.
  expect(vacationStored.planningStatus, "Abwesenheit muss FIX sein").toBe("FIX");

  // Zuschlagsfortzahlung: Die Modellzeiten decken das Nachtfenster (23–06 Uhr)
  // ab — ohne die Zeitableitung gaebe es hier 0 Nachtstunden.
  expect(
    vacationStored.nightHours ?? 0,
    "Abwesenheit muss Nachtstunden aus den Modellzeiten tragen"
  ).toBeGreaterThan(0);

  // Lohnfortzahlung: valuedHours entsprechen exakt den Modellstunden.
  expect(round2(vacationStored.valuedHours ?? 0)).toBe(
    round2(hoursBetween(vacationStored.startTime, vacationStored.endTime))
  );
});

test("Lohnauswertung: Soll = Modellstunden, Bilanz 0, Nacht-Zuschlaege fortgefuehrt", async () => {
  expect(vacationShiftId, "Urlaubsschicht aus vorherigem Test fehlt").toBeTruthy();

  const modelHours = round2(
    hoursBetween(vacationStored.startTime, vacationStored.endTime)
  );
  const fulfilledHours = round2(vacationStored.valuedHours ?? 0);
  expect(modelHours, "Modellstunden muessen > 0 sein").toBeGreaterThan(0);

  const res = await adminCtx.get(
    `/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`
  );
  expect(res.ok(), `GET hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Assistent fehlt in der Lohnauswertung").toBeTruthy();

  // Soll: Die Modellzeiten-Abwesenheit zaehlt wie ein geplanter Dienst zum
  // Plan (inheritedAbsenceHours) — NICHT wie ein ganztaegiger Eintrag (der
  // gar nicht zum Soll zaehlen wuerde).
  expect(row!.plannedHours, "Soll muss den Modellstunden entsprechen").toBe(modelHours);

  // Erfuellt: Lohnfortzahlung der Abwesenheit erfuellt exakt dieses Soll.
  expect(row!.vacationFulfilledHours).toBe(fulfilledHours);
  expect(row!.totalFulfilledHours).toBe(fulfilledHours);
  expect(row!.vacationDaysTaken).toBe(1);

  // Kern des Tests: Bilanz NEUTRAL (Soll = Ist der Lohnfortzahlung).
  expect(row!.balance, "Bilanz muss neutral (0) bleiben").toBe(0);

  // Zuschlagsfortzahlung in der Auswertung: Die Nachtstunden der Abwesenheit
  // erscheinen als Nacht- und Nacht-Zuschlagsstunden (Satz aus den
  // angewandten Einstellungen der Zeile — keine Duplikation der Kette).
  const nightHours = round2(vacationStored.nightHours ?? 0);
  expect(row!.nightHours, "Nachtstunden fehlen in der Auswertung").toBe(nightHours);
  expect(row!.nightSurchargeHours, "Nacht-Zuschlagsstunden fehlen").toBe(
    round2((nightHours * row!.nightPercent) / 100)
  );
});
