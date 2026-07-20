import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Regressionsschutz fuer den BASIS-Abwesenheits-Zeitpfad (#451): Urlaub auf
 * einem LEEREN Tag OHNE verknuepftes Schichtmodell.
 *
 * Von den drei Abwesenheits-Zeitpfaden in POST /api/shifts sind der ersetzte
 * Dienst (dienstplan-abwesenheit-ersetzt-dienst-bilanz-api.spec.ts) und der
 * Schichtmodell-Fallback (dienstplan-abwesenheit-schichtmodell-zeiten-api.spec.ts)
 * bereits abgesichert. Dieser Spec deckt den verbleibenden Basis-Fall ab:
 *
 * - Ohne shiftModelId und ohne geplanten Dienst am Tag bleibt der Urlaub ein
 *   ganztaegiger 00:00–23:59-Eintrag (Frontend-Konvention).
 * - isPlainFullDay greift: KEINE Zuschlaege (nightHours/sundayHours/
 *   holidayHours = 0), valuedHours = vertragliche Tages-Soll-Stunden.
 * - In der Lohnauswertung zaehlt der ganztaegige Eintrag NICHT zum Soll
 *   (inheritedAbsenceHours nur fuer echte Schichtzeiten), die
 *   Lohnfortzahlung kommt allein aus valuedHours (vacationFulfilledHours).
 *
 * Eine Regression am isPlainFullDay-Erkenner wuerde ganztaegige Urlaube ploetzlich
 * mit ~24h ins Soll heben oder Zuschlaege erfinden.
 *
 * Fester Monat (Oktober des Vertragsjahres, Mittwoch im Fenster 10.–16.10. —
 * weder Sonntag noch bundesweiter Feiertag); der Setup-Admin ist premium
 * (hours-balance ist Premium-gegated).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const YEAR = new Date().getFullYear();
const MONTH = 10;

function findWednesday(): string {
  for (let day = 10; day <= 16; day++) {
    const d = new Date(`${YEAR}-10-${String(day).padStart(2, "0")}T12:00:00Z`);
    if (d.getUTCDay() === 3) return `${YEAR}-10-${String(day).padStart(2, "0")}`;
  }
  throw new Error("Kein Mittwoch im Fenster 10.-16.10. gefunden");
}
const ABSENCE_DAY = findWednesday();

// Ganztaegige Abwesenheit, exakt wie das Frontend sie sendet (00:00–23:59).
const FULL_DAY_START = `${ABSENCE_DAY}T00:00:00.000Z`;
const FULL_DAY_END = `${ABSENCE_DAY}T23:59:59.000Z`;

type Shift = {
  id: number;
  startTime: string;
  endTime: string;
  shiftModelId?: number | null;
  valuedHours?: number | null;
  nightHours?: number | null;
  sundayHours?: number | null;
  holidayHours?: number | null;
  planningStatus?: string | null;
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
  sundayHours: number;
  sundaySurchargeHours: number;
  holidayHours: number;
  holidaySurchargeHours: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

let adminCtx: APIRequestContext;
let assistantId: number;
let contractId: number;
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

  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E GanztagUrlaub ${unique}`,
      email: `e2e.ganztagurlaub.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Assistent anlegen fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Vertrag ab Jahresbeginn: bestimmt die vertraglichen Tages-Soll-Stunden
  // (Lohnfortzahlung) und ist noetig fuer die Urlaubs-Buchhaltung.
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
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistantId) await adminCtx.delete(`/api/users/${assistantId}`);
  await adminCtx.dispose();
});

test("Ganztags-Urlaub ohne Modell bleibt 00:00–23:59 und traegt keine Zuschlaege", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "vacation",
      startTime: FULL_DAY_START,
      endTime: FULL_DAY_END,
    },
  });
  expect(res.status(), `Urlaub anlegen sollte 201 liefern (${res.status()})`).toBe(201);
  vacationShiftId = ((await res.json()) as Shift).id;

  // Round-Trip ueber die DB: Ohne Modell und ohne geplanten Dienst bleiben die
  // ganztaegigen Zeiten unveraendert (kein Ersetzen, keine Modellzeiten).
  vacationStored = await fetchShift(vacationShiftId);
  expect(vacationStored.shiftModelId ?? null, "Urlaub darf kein Modell tragen").toBeNull();
  expect(new Date(vacationStored.startTime).toISOString()).toBe(FULL_DAY_START);
  expect(new Date(vacationStored.endTime).toISOString()).toBe(FULL_DAY_END);

  // Abwesenheiten sind serverseitig immer verbindlich.
  expect(vacationStored.planningStatus, "Abwesenheit muss FIX sein").toBe("FIX");

  // isPlainFullDay: KEINE Zuschlagsstunden, obwohl 23:00–23:59 im Nachtfenster
  // laege — der ganztaegige Eintrag wird rein plan-basiert gewertet.
  expect(vacationStored.nightHours ?? 0, "Ganztags-Urlaub darf keine Nachtstunden tragen").toBe(0);
  expect(vacationStored.sundayHours ?? 0, "keine Sonntagsstunden").toBe(0);
  expect(vacationStored.holidayHours ?? 0, "keine Feiertagsstunden").toBe(0);

  // Lohnfortzahlung: valuedHours = vertragliche Tages-Soll-Stunden — exakt
  // 8,0 h (Vertrag 40 h/Woche, 5-Tage-Woche). Der exakte Wert schuetzt vor
  // einer Regression, die stattdessen ~24 h (ganztaegige Rohdauer) wertet.
  expect(
    round2(vacationStored.valuedHours ?? 0),
    "valuedHours muessen exakt die vertraglichen Tagesstunden (8) tragen",
  ).toBe(8);
});

test("Lohnauswertung: kein Soll-Beitrag, Lohnfortzahlung aus valuedHours, keine Zuschlaege", async () => {
  expect(vacationShiftId, "Urlaubsschicht aus vorherigem Test fehlt").toBeTruthy();

  const fulfilledHours = round2(vacationStored.valuedHours ?? 0);

  const res = await adminCtx.get(
    `/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`,
  );
  expect(res.ok(), `GET hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Assistent fehlt in der Lohnauswertung").toBeTruthy();

  // Kern des Tests: Ein ganztaegiger Urlaub zaehlt NICHT zum Soll (Plan) — ohne
  // geplante Arbeitsschichten bleibt plannedHours 0 (inheritedAbsenceHours greift
  // NUR fuer echte Schichtzeiten, nicht fuer 00:00–23:59-Eintraege).
  expect(row!.plannedHours, "Ganztags-Urlaub darf nicht zum Soll zaehlen").toBe(0);

  // Lohnfortzahlung: kommt allein aus valuedHours der Abwesenheit.
  expect(row!.vacationFulfilledHours).toBe(fulfilledHours);
  expect(row!.totalFulfilledHours).toBe(fulfilledHours);
  expect(row!.vacationDaysTaken).toBe(1);

  // Keine Zuschlagsstunden aus der Abwesenheit.
  expect(row!.nightHours, "keine Nachtstunden in der Auswertung").toBe(0);
  expect(row!.nightSurchargeHours, "keine Nacht-Zuschlagsstunden").toBe(0);
  expect(row!.sundayHours, "keine Sonntagsstunden").toBe(0);
  expect(row!.sundaySurchargeHours, "keine Sonntags-Zuschlagsstunden").toBe(0);
  expect(row!.holidayHours, "keine Feiertagsstunden").toBe(0);
  expect(row!.holidaySurchargeHours, "keine Feiertags-Zuschlagsstunden").toBe(0);
});
