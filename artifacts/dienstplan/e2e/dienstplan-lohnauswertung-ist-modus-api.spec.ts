import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Regressionstest: Die Premium-Lohnauswertung (GET /dashboard/hours-balance)
 * rechnet die GELDWERTE (basePay/nightSurchargePay/totalPay) nach der
 * Abrechnungsart — derselbe Datenbestand liefert im SOLL-Modus Geld aus den
 * geplanten FIX-Schichten und im IST-Modus Geld aus den BESTÄTIGTEN Ist-Zeiten.
 * Der Test deckt damit den kompletten Routen-Pfad ab, den die Unit-Tests
 * (dashboard-hours-balance.test.ts) nicht sehen: den Join der Vergütungsfelder
 * des Schichtmodells (regular/percentage/flat) an Schichten UND Ist-Zeiten
 * sowie die Verkabelung der Ist-Metriken (valued-/nightHours aus
 * actualStart/actualEnd).
 *
 * Aufbau (fester Monat Oktober 2026, Mo 12. – Do 15.: keine Sonntage, keine
 * bundesweiten Feiertage — Sonntags-/Feiertagszuschläge sind hier bewusst 0):
 * - Frisches Privat-Konto (Premium via DB-Helper), Assistent mit Stundenlohn
 *   20 EUR im Standard-Team (teamId weggelassen -> resolveWriteTeamId-Fallback).
 * - Drei Dienste mit unterschiedlichem Vergütungstyp:
 *   regular (Nachtdienst Mo 22:00–Di 06:00), percentage 50 % (Di 08–18),
 *   flat 50 EUR (Mi 08–12). Dazu Urlaub (ganztägig, Do) mit Vertrag 40h/Woche
 *   -> Lohnfortzahlung 8h.
 * - Bestätigte Ist-Zeiten weichen bewusst vom Plan ab (Nachtdienst identisch,
 *   percentage 9h statt 10h, flat 3h statt 4h), damit SOLL- und IST-Geldwerte
 *   unterscheidbar sind.
 *
 * Erwartungswerte für die SOLL-Seite werden aus den GESPEICHERTEN Kennzahlen
 * der Schichten (GET /api/shifts/:id: valuedHours/nightHours) abgeleitet —
 * keine Duplikation der Bewertungs-Engine. Für die IST-Seite ist die Ist-Zeit
 * des Nachtdienstes deckungsgleich mit der Planung, sodass auch dort die
 * gespeicherten Nachtstunden der Schicht als Erwartung dienen (identische
 * Zeiten -> identische Metriken, unabhängig von der Server-Zeitzone).
 */

const YEAR = 2026;
const MONTH = 10;
const WAGE = 20;
const NIGHT_PERCENT = 25;
const PCT_PERCENT = 50; // Vergütungstyp percentage: 50 % des Stundenlohns
const FLAT_CENTS = 5000; // Vergütungstyp flat: 50 EUR pro Schicht

// Mo 12.10.2026 bis Do 15.10.2026.
const NIGHT_START = "2026-10-12T22:00:00.000Z";
const NIGHT_END = "2026-10-13T06:00:00.000Z";
const PCT_START = "2026-10-13T08:00:00.000Z";
const PCT_END = "2026-10-13T18:00:00.000Z"; // Plan 10h
const PCT_IST_END = "2026-10-13T17:00:00.000Z"; // Ist 9h
const FLAT_START = "2026-10-14T08:00:00.000Z";
const FLAT_END = "2026-10-14T12:00:00.000Z"; // Plan 4h
const FLAT_IST_END = "2026-10-14T11:00:00.000Z"; // Ist 3h
const VACATION_DAY = "2026-10-15";

let acc: FreeAccount;
let assistantId = 0;
let nightShiftId = 0;
let pctShiftId = 0;
let flatShiftId = 0;
let vacationShiftId = 0;

interface ShiftMetrics {
  id: number;
  valuedHours?: number | null;
  nightHours?: number | null;
  sundayHours?: number | null;
  holidayHours?: number | null;
}

interface BalanceRow {
  userId: number;
  billingMethod: "SOLL" | "IST";
  valuedHours: number;
  vacationFulfilledHours: number;
  nightSurchargeHours: number;
  hourlyWage: number | null;
  basePay: number | null;
  nightSurchargePay: number | null;
  sundaySurchargePay: number | null;
  holidaySurchargePay: number | null;
  totalPay: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Abrechnungsart umschalten; Zuschläge/Nachtfenster bleiben auf bekannten Werten. */
async function setBillingMethod(method: "SOLL" | "IST"): Promise<void> {
  const res = await acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: NIGHT_PERCENT,
      nightStart: "23:00",
      nightEnd: "06:00",
      sundayPercent: 50,
      holidayPercent: 100,
      billingMethod: method,
      timeTrackingEnabled: true,
    },
  });
  expect(res.ok(), `PUT allowance-settings fehlgeschlagen (${res.status()})`).toBe(true);
  const body = (await res.json()) as { billingMethod: string; timeTrackingEnabled: boolean };
  expect(body.billingMethod).toBe(method);
  expect(body.timeTrackingEnabled, "Zeiterfassung muss aktiv bleiben").toBe(true);
}

async function fetchShift(id: number): Promise<ShiftMetrics> {
  const res = await acc.ctx.get(`/api/shifts/${id}`);
  expect(res.ok(), `GET /api/shifts/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as ShiftMetrics;
}

async function fetchBalanceRow(): Promise<BalanceRow> {
  const res = await acc.ctx.get(`/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`);
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Zeile des Assistenten erwartet").toBeTruthy();
  return row!;
}

async function createShift(data: Record<string, unknown>): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", { data });
  expect(res.status(), `Schicht anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createConfirmedEntry(
  shiftId: number,
  actualStart: string,
  actualEnd: string,
): Promise<void> {
  const res = await acc.ctx.post("/api/time-tracking", {
    data: { userId: assistantId, shiftId, actualStart, actualEnd },
  });
  expect(res.status(), `Ist-Zeit anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  const entryId = ((await res.json()) as { id: number }).id;
  const confirmRes = await acc.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
    data: { status: "confirmed" },
  });
  expect(confirmRes.ok(), `Bestätigen fehlgeschlagen (${confirmRes.status()})`).toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "istlohn");
  await setAccountPlan(acc.email, "premium");

  // Assistent mit Stundenlohn im Standard-Team.
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Ist-Lohn Assistent ${Date.now()}`,
      email: `e2e.istlohn.assistent.${Date.now()}@dienstplan.test`,
      role: "assistant",
      hourlyWage: WAGE,
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Vertrag 40h/Woche ab Jahresbeginn: bewertet die ganztägige Abwesenheit
  // (8h/Tag) und deckt den Urlaubstag (vacation_outside_contract-Guard).
  const contractRes = await acc.ctx.post("/api/contracts", {
    data: { userId: assistantId, startDate: `${YEAR}-01-01`, weeklyHours: 40, vacationDays: 30 },
  });
  expect(contractRes.status(), "Vertrag sollte 201 liefern").toBe(201);

  // Zeiterfassung EIN (Konto-Schalter, Standard AUS) + Startmodus SOLL.
  await setBillingMethod("SOLL");

  // Drei Dienste mit unterschiedlichem Vergütungstyp.
  const createModel = async (data: Record<string, unknown>): Promise<number> => {
    const res = await acc.ctx.post("/api/shift-models", { data });
    expect(res.status(), `Dienst anlegen fehlgeschlagen (${res.status()})`).toBe(201);
    return ((await res.json()) as { id: number }).id;
  };
  const regularModelId = await createModel({ name: "E2E Regulär", compensationType: "regular" });
  const pctModelId = await createModel({
    name: "E2E Prozent",
    compensationType: "percentage",
    compensationPercent: PCT_PERCENT,
  });
  const flatModelId = await createModel({
    name: "E2E Pauschal",
    compensationType: "flat",
    compensationFlatCents: FLAT_CENTS,
  });

  // Geplante FIX-Schichten (nur FIX zählt in der Auswertung).
  nightShiftId = await createShift({
    userId: assistantId,
    shiftModelId: regularModelId,
    type: "active",
    planningStatus: "FIX",
    startTime: NIGHT_START,
    endTime: NIGHT_END,
  });
  pctShiftId = await createShift({
    userId: assistantId,
    shiftModelId: pctModelId,
    type: "active",
    planningStatus: "FIX",
    startTime: PCT_START,
    endTime: PCT_END,
  });
  flatShiftId = await createShift({
    userId: assistantId,
    shiftModelId: flatModelId,
    type: "active",
    planningStatus: "FIX",
    startTime: FLAT_START,
    endTime: FLAT_END,
  });
  // Ganztägiger Urlaub (00:00–23:59 in Server-Lokalzeit, wie das Frontend
  // ihn sendet) -> Lohnfortzahlung mit den vertraglichen Tages-Soll-Stunden.
  vacationShiftId = await createShift({
    userId: assistantId,
    type: "vacation",
    startTime: new Date(`${VACATION_DAY}T00:00:00`).toISOString(),
    endTime: new Date(`${VACATION_DAY}T23:59:59`).toISOString(),
  });

  // Bestätigte Ist-Zeiten: Nachtdienst deckungsgleich mit dem Plan, die
  // beiden Tagdienste bewusst KÜRZER als geplant (9h statt 10h, 3h statt 4h).
  await createConfirmedEntry(nightShiftId, NIGHT_START, NIGHT_END);
  await createConfirmedEntry(pctShiftId, PCT_START, PCT_IST_END);
  await createConfirmedEntry(flatShiftId, FLAT_START, FLAT_IST_END);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("SOLL-Modus: Geldwerte aus den geplanten FIX-Schichten (regular/percentage/flat + Lohnfortzahlung)", async () => {
  const night = await fetchShift(nightShiftId);
  const pct = await fetchShift(pctShiftId);
  const flat = await fetchShift(flatShiftId);
  const vacation = await fetchShift(vacationShiftId);

  // Sanity der Erwartungsbasis: gespeicherte Kennzahlen der Schichten.
  expect(night.valuedHours ?? 0).toBeCloseTo(8, 2);
  expect(night.nightHours ?? 0, "Nachtdienst muss Nachtstunden tragen").toBeGreaterThan(0);
  expect(pct.valuedHours ?? 0).toBeCloseTo(10, 2);
  expect(flat.valuedHours ?? 0).toBeCloseTo(4, 2);
  expect(vacation.valuedHours ?? 0).toBeCloseTo(8, 2);
  // Keine Sonntage/Feiertage im gewählten Zeitraum (Mo–Do, Oktober).
  for (const s of [night, pct, flat, vacation]) {
    expect(s.sundayHours ?? 0).toBeCloseTo(0, 2);
    expect(s.holidayHours ?? 0).toBeCloseTo(0, 2);
  }

  const row = await fetchBalanceRow();
  expect(row.billingMethod).toBe("SOLL");
  expect(row.hourlyWage).toBeCloseTo(WAGE, 2);
  expect(row.vacationFulfilledHours).toBeCloseTo(vacation.valuedHours ?? 0, 2);

  // Grundvergütung je Vergütungstyp aus dem PLAN + Lohnfortzahlung:
  // regular 8h*20 + percentage 10h*20*50% + flat 50 EUR + Urlaub 8h*20.
  const expectedBase =
    WAGE * (night.valuedHours ?? 0) +
    WAGE * (pct.valuedHours ?? 0) * (PCT_PERCENT / 100) +
    FLAT_CENTS / 100 +
    WAGE * (vacation.valuedHours ?? 0);
  expect(row.basePay, "SOLL-Grundvergütung falsch").toBeCloseTo(round2(expectedBase), 2);

  // Nachtzuschlag aus den GEPLANTEN Nachtstunden aller Schichten.
  const plannedNightHours =
    (night.nightHours ?? 0) + (pct.nightHours ?? 0) + (flat.nightHours ?? 0) + (vacation.nightHours ?? 0);
  expect(row.nightSurchargeHours).toBeCloseTo(plannedNightHours * (NIGHT_PERCENT / 100), 2);
  expect(row.nightSurchargePay, "SOLL-Nachtzuschlag falsch").toBeCloseTo(
    round2(plannedNightHours * (NIGHT_PERCENT / 100) * WAGE),
    2,
  );
  expect(row.sundaySurchargePay ?? 0).toBeCloseTo(0, 2);
  expect(row.holidaySurchargePay ?? 0).toBeCloseTo(0, 2);
  expect(row.totalPay).toBeCloseTo(round2((row.basePay ?? 0) + (row.nightSurchargePay ?? 0)), 2);
});

test("IST-Modus: Geldwerte aus den bestätigten Ist-Zeiten plus Urlaubs-Lohnfortzahlung", async () => {
  await setBillingMethod("IST");

  const night = await fetchShift(nightShiftId);
  const vacation = await fetchShift(vacationShiftId);

  const row = await fetchBalanceRow();
  expect(row.billingMethod).toBe("IST");
  expect(row.hourlyWage).toBeCloseTo(WAGE, 2);

  // Gewertete Stunden = bestätigte Ist-Zeiten (8h + 9h + 3h), NICHT der Plan.
  expect(row.valuedHours, "IST-Stunden müssen aus den Ist-Zeiten kommen").toBeCloseTo(8 + 9 + 3, 2);

  // Grundvergütung: der Vergütungstyp des verknüpften Dienstes greift auch im
  // IST-Modus (Routen-Join Ist-Zeit -> Schicht -> Schichtmodell):
  // regular 8h*20 + percentage 9h*20*50% + flat 50 EUR (dauerunabhängig,
  // trotz nur 3h Ist) + Lohnfortzahlung Urlaub 8h*20 (planbasiert).
  const expectedBase =
    WAGE * 8 + WAGE * 9 * (PCT_PERCENT / 100) + FLAT_CENTS / 100 + WAGE * (vacation.valuedHours ?? 0);
  expect(row.basePay, "IST-Grundvergütung falsch").toBeCloseTo(round2(expectedBase), 2);
  expect(row.vacationFulfilledHours).toBeCloseTo(vacation.valuedHours ?? 0, 2);

  // Nachtzuschlag aus den IST-Zeiten: Die Ist-Zeit des Nachtdienstes ist
  // deckungsgleich mit dem Plan -> identische Nachtstunden wie gespeichert;
  // die Tag-Einträge liegen komplett außerhalb des Nachtfensters (23–06).
  const istNightHours = (night.nightHours ?? 0) + (vacation.nightHours ?? 0);
  expect(row.nightSurchargeHours).toBeCloseTo(istNightHours * (NIGHT_PERCENT / 100), 2);
  expect(row.nightSurchargePay, "IST-Nachtzuschlag falsch").toBeCloseTo(
    round2(istNightHours * (NIGHT_PERCENT / 100) * WAGE),
    2,
  );
  expect(row.sundaySurchargePay ?? 0).toBeCloseTo(0, 2);
  expect(row.holidaySurchargePay ?? 0).toBeCloseTo(0, 2);
  expect(row.totalPay).toBeCloseTo(round2((row.basePay ?? 0) + (row.nightSurchargePay ?? 0)), 2);
});

test("Regressionssignal: SOLL- und IST-Grundvergütung unterscheiden sich bei abweichenden Ist-Zeiten", async () => {
  // Zurück auf SOLL und beide Werte direkt vergleichen: percentage 10h->9h
  // (-10 EUR) und flat-Stunden ohne Geldwirkung — würde die Route die
  // Abrechnungsart ignorieren, wären beide Grundlöhne identisch.
  await setBillingMethod("SOLL");
  const sollRow = await fetchBalanceRow();
  await setBillingMethod("IST");
  const istRow = await fetchBalanceRow();

  expect(sollRow.billingMethod).toBe("SOLL");
  expect(istRow.billingMethod).toBe("IST");
  expect(sollRow.basePay).not.toBeNull();
  expect(istRow.basePay).not.toBeNull();
  expect((sollRow.basePay ?? 0) - (istRow.basePay ?? 0), "SOLL muss um die Plan-Differenz höher liegen").toBeCloseTo(
    WAGE * 1 * (PCT_PERCENT / 100), // percentage: 1h weniger Ist à 50 %
    2,
  );
});
