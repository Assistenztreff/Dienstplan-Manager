import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Regressionstest: Der Monatsabschluss friert EXAKT die Geldwerte der
 * Lohnauswertung (GET /dashboard/hours-balance) ein, und die Nachberechnung
 * (GET /month-closings/diff) liefert nach einer nachträglichen Änderung die
 * präzise Differenz — Stunden UND Geld (diffBasePay/diffSurchargePay).
 *
 * Aufbau (fester Monat März; im Jan/Feb weicht der Test ins Vorjahr aus,
 * damit der Monat immer abschließbar ist):
 * - Frisches Premium-Privat-Konto, Assistent mit Stundenlohn 20 EUR.
 * - Abrechnungsart IST + Zeiterfassung EIN (Nachtzuschlag 25 %, Fenster 23–06).
 * - Tagdienst (08–16) + Nachtdienst (22–06), beide FIX mit deckungsgleich
 *   BESTÄTIGTEN Ist-Zeiten — Erwartungswerte für Nachtstunden kommen aus den
 *   GESPEICHERTEN Kennzahlen der Schichten (identische Zeiten -> identische
 *   Metriken, unabhängig von der Server-Zeitzone).
 * - Schnappschuss der Lohnauswertung VOR dem Abschluss = Referenz-Erwartung.
 * - Nach dem Abschluss: weiterer Nachtdienst inkl. bestätigter Ist-Zeit ->
 *   der Diff muss reported* exakt auf dem Schnappschuss und current* exakt
 *   auf der neuen Auswertung tragen; diffBasePay/diffSurchargePay exakt.
 */

const MONTH = 3;
const now = new Date();
const YEAR = now.getMonth() + 1 > MONTH ? now.getFullYear() : now.getFullYear() - 1;
const WAGE = 20;
const NIGHT_PERCENT = 25;

const q = `month=${MONTH}&year=${YEAR}`;

type BalanceRow = {
  userId: number;
  billingMethod: "SOLL" | "IST";
  totalFulfilledHours: number;
  nightSurchargeHours: number;
  hourlyWage: number | null;
  basePay: number | null;
  nightSurchargePay: number | null;
  sundaySurchargePay: number | null;
  holidaySurchargePay: number | null;
  totalPay: number | null;
};

type DiffRow = {
  userId: number;
  userName: string;
  reportedHours: number;
  currentHours: number;
  diffHours: number;
  reportedPay: number | null;
  currentPay: number | null;
  diffPay: number | null;
  diffBasePay: number | null;
  diffSurchargePay: number | null;
};

type Diff = { closed: boolean; closedAt?: string; rows: DiffRow[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

let acc: FreeAccount;
let assistantId = 0;
let dayEntryId = 0;

function localIso(day: string, time: string): string {
  return new Date(`${YEAR}-03-${day}T${time}:00`).toISOString();
}

async function createFixShift(startIso: string, endIso: string): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type: "work",
      planningStatus: "FIX",
      force: true,
      startTime: startIso,
      endTime: endIso,
    },
  });
  expect(res.status(), `Schicht anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createConfirmedEntry(
  shiftId: number,
  startIso: string,
  endIso: string,
): Promise<number> {
  const res = await acc.ctx.post("/api/time-tracking", {
    data: { userId: assistantId, shiftId, actualStart: startIso, actualEnd: endIso },
  });
  expect(res.status(), `Ist-Zeit anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  const entryId = ((await res.json()) as { id: number }).id;
  const confirm = await acc.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
    data: { status: "confirmed" },
  });
  expect(confirm.ok(), `Bestätigen fehlgeschlagen (${confirm.status()})`).toBe(true);
  return entryId;
}

type ShiftMetrics = {
  nightHours?: number | null;
  sundayHours?: number | null;
  holidayHours?: number | null;
};

async function fetchShiftMetrics(shiftId: number): Promise<ShiftMetrics> {
  const res = await acc.ctx.get(`/api/shifts/${shiftId}`);
  expect(res.ok(), `GET /api/shifts/${shiftId} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as ShiftMetrics;
}

// Erwarteter Zuschlags-Geldwert einer Schicht aus den GESPEICHERTEN
// Kennzahlen (Nacht 25 %, Sonntag 50 %, Feiertag 100 % — wie im PUT gesetzt).
function surchargePayOf(m: ShiftMetrics): number {
  return round2(
    ((m.nightHours ?? 0) * (NIGHT_PERCENT / 100) +
      (m.sundayHours ?? 0) * 0.5 +
      (m.holidayHours ?? 0) * 1.0) *
      WAGE,
  );
}

async function fetchBalanceRow(): Promise<BalanceRow> {
  const res = await acc.ctx.get(`/api/dashboard/hours-balance?${q}`);
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Zeile des Assistenten erwartet").toBeTruthy();
  return row!;
}

async function fetchDiff(): Promise<Diff> {
  const res = await acc.ctx.get(`/api/month-closings/diff?${q}`);
  expect(res.ok(), `GET diff fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Diff;
}

test.describe.configure({ mode: "serial" });

// Schnappschuss der Auswertung unmittelbar VOR dem Abschluss — die
// eingefrorene Referenz muss exakt diesen Stand tragen.
let snapshot: BalanceRow;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "abschluss-geld");
  await setAccountPlan(acc.email, "premium");

  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Abschluss-Geld Assistent ${Date.now()}`,
      email: `e2e.abschluss.geld.${Date.now()}@dienstplan.test`,
      role: "assistant",
      hourlyWage: WAGE,
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Abrechnungsart IST + Zeiterfassung EIN, bekannte Zuschlags-Sätze.
  const settingsRes = await acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: NIGHT_PERCENT,
      nightStart: "23:00",
      nightEnd: "06:00",
      sundayPercent: 50,
      holidayPercent: 100,
      billingMethod: "IST",
      timeTrackingEnabled: true,
    },
  });
  expect(settingsRes.ok(), `PUT allowance-settings fehlgeschlagen (${settingsRes.status()})`).toBe(true);

  // Tagdienst Di 10.03 08–16 und Nachtdienst Do 12.03 22–06, beide mit
  // deckungsgleich bestätigten Ist-Zeiten (IST-Modus).
  const dayStart = localIso("10", "08:00");
  const dayEnd = localIso("10", "16:00");
  const dayId = await createFixShift(dayStart, dayEnd);
  dayEntryId = await createConfirmedEntry(dayId, dayStart, dayEnd);

  const nightStart = localIso("12", "22:00");
  const nightEnd = new Date(`${YEAR}-03-13T06:00:00`).toISOString();
  const nightId = await createFixShift(nightStart, nightEnd);
  await createConfirmedEntry(nightId, nightStart, nightEnd);

  // Sanity: der Nachtdienst muss Nachtstunden tragen, sonst prüft der Test
  // die Zuschlags-Geldwerte nicht wirklich.
  const nightMetrics = await fetchShiftMetrics(nightId);
  expect(nightMetrics.nightHours ?? 0, "Nachtdienst ohne Nachtstunden").toBeGreaterThan(0);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Auswertung vor Abschluss: Grundlohn + Nachtzuschlag exakt nachvollziehbar", async () => {
  snapshot = await fetchBalanceRow();
  expect(snapshot.billingMethod).toBe("IST");
  expect(snapshot.hourlyWage).toBeCloseTo(WAGE, 2);
  // 8h Tag + 8h Nacht, bestätigt.
  expect(snapshot.totalFulfilledHours).toBeCloseTo(16, 2);
  expect(snapshot.basePay, "Grundlohn = 16h × 20 EUR").toBeCloseTo(round2(16 * WAGE), 2);
  expect(snapshot.nightSurchargePay ?? 0, "Nachtzuschlag muss > 0 sein").toBeGreaterThan(0);
  expect(snapshot.nightSurchargePay).toBeCloseTo(
    round2(snapshot.nightSurchargeHours * WAGE),
    2,
  );
  // Je nach Jahr können die Schichten aufs Wochenende fallen — die
  // Gesamtsumme muss aber IMMER Grundlohn + alle Zuschläge sein.
  expect(snapshot.totalPay).toBeCloseTo(
    round2(
      (snapshot.basePay ?? 0) +
        (snapshot.nightSurchargePay ?? 0) +
        (snapshot.sundaySurchargePay ?? 0) +
        (snapshot.holidaySurchargePay ?? 0),
    ),
    2,
  );
});

test("Abschluss friert exakt den Schnappschuss ein (Diff sofort leer)", async () => {
  const res = await acc.ctx.post("/api/month-closings", { data: { month: MONTH, year: YEAR } });
  expect(res.status(), `Abschließen (${res.status()})`).toBe(201);

  // Kein Drift zwischen Abschluss und Auswertung: Diff direkt danach leer.
  const diff = await fetchDiff();
  expect(diff.closed).toBe(true);
  expect(diff.rows, "Direkt nach dem Abschluss darf es keine Abweichung geben").toEqual([]);
});

test("Nachträgliche Schicht: Diff trägt exakt Schnappschuss vs. neue Auswertung", async () => {
  // Weiterer Nachtdienst Sa 14.03 22–06 inkl. bestätigter Ist-Zeit.
  const extraStart = localIso("14", "22:00");
  const extraEnd = new Date(`${YEAR}-03-15T06:00:00`).toISOString();
  const extraId = await createFixShift(extraStart, extraEnd);
  await createConfirmedEntry(extraId, extraStart, extraEnd);
  const extraMetrics = await fetchShiftMetrics(extraId);
  expect(extraMetrics.nightHours ?? 0, "Nachtrag muss Nachtstunden tragen").toBeGreaterThan(0);

  const current = await fetchBalanceRow();
  const diff = await fetchDiff();
  expect(diff.closed).toBe(true);
  expect(diff.rows).toHaveLength(1);
  const row = diff.rows[0];
  expect(row.userId).toBe(assistantId);

  // reported* = eingefrorener Schnappschuss (exakt der Stand VOR dem Abschluss).
  expect(row.reportedHours).toBeCloseTo(round2(snapshot.totalFulfilledHours), 2);
  expect(row.reportedPay, "Eingefrorenes Geld muss dem Schnappschuss entsprechen").toBeCloseTo(
    round2(snapshot.totalPay ?? 0),
    2,
  );

  // current* = aktuelle Auswertung.
  expect(row.currentHours).toBeCloseTo(round2(current.totalFulfilledHours), 2);
  expect(row.currentPay).toBeCloseTo(round2(current.totalPay ?? 0), 2);

  // Differenzen: 8h Grundlohn + die Zuschläge des Nachtrags (Nacht/Sonntag/
  // Feiertag aus den gespeicherten Kennzahlen — je nach Jahr kann der
  // 14./15.03. auf ein Wochenende fallen).
  expect(row.diffHours).toBeCloseTo(8, 2);
  expect(row.diffBasePay, "Grundlohn-Differenz = 8h × 20 EUR").toBeCloseTo(round2(8 * WAGE), 2);
  const expectedSurchargeDiff = surchargePayOf(extraMetrics);
  expect(row.diffSurchargePay, "Zuschlags-Differenz aus den Kennzahlen des Nachtrags").toBeCloseTo(
    expectedSurchargeDiff,
    2,
  );
  expect(row.diffPay).toBeCloseTo(round2((row.diffBasePay ?? 0) + (row.diffSurchargePay ?? 0)), 2);
  // Konsistenz: Differenz = aktuelle minus eingefrorene Gesamtsumme.
  expect(row.diffPay).toBeCloseTo(round2((current.totalPay ?? 0) - (snapshot.totalPay ?? 0)), 2);
});

test("Erneuter Abschluss übernimmt den neuen Stand (Diff wieder leer)", async () => {
  const res = await acc.ctx.post("/api/month-closings", { data: { month: MONTH, year: YEAR } });
  expect(res.status(), `Erneut abschließen (${res.status()})`).toBe(201);
  const diff = await fetchDiff();
  expect(diff.rows).toEqual([]);
});

test("Bestehende Ist-Zeit nachträglich ÄNDERN: Diff exakt +1h Grundlohn", async () => {
  // Referenz-Stand nach dem zweiten Abschluss festhalten.
  const before = await fetchBalanceRow();

  // Bestätigte Ist-Zeit des Tagdienstes verlängern: 08–16 -> 08–17 (+1h,
  // komplett außerhalb des Nachtfensters 23–06).
  const patchRes = await acc.ctx.patch(`/api/time-tracking/${dayEntryId}`, {
    data: {
      actualStart: localIso("10", "08:00"),
      actualEnd: localIso("10", "17:00"),
    },
  });
  expect(patchRes.ok(), `Ist-Zeit ändern fehlgeschlagen (${patchRes.status()})`).toBe(true);

  const current = await fetchBalanceRow();
  const diff = await fetchDiff();
  expect(diff.closed).toBe(true);
  expect(diff.rows).toHaveLength(1);
  const row = diff.rows[0];
  expect(row.userId).toBe(assistantId);

  // reported* = eingefrorener Stand des zweiten Abschlusses.
  expect(row.reportedHours).toBeCloseTo(round2(before.totalFulfilledHours), 2);
  expect(row.reportedPay).toBeCloseTo(round2(before.totalPay ?? 0), 2);
  expect(row.currentHours).toBeCloseTo(round2(current.totalFulfilledHours), 2);
  expect(row.currentPay).toBeCloseTo(round2(current.totalPay ?? 0), 2);

  // Exakte Abweichung: +1h × 20 EUR Grundlohn, Zuschläge je nach Wochentag
  // (10.03. kann auf einen Sonntag fallen) — daher direkt gegen die
  // Auswertungs-Differenz prüfen.
  expect(row.diffHours).toBeCloseTo(1, 2);
  expect(row.diffBasePay, "Grundlohn-Differenz = 1h × 20 EUR").toBeCloseTo(round2(WAGE), 2);
  expect(row.diffSurchargePay).toBeCloseTo(
    round2((current.nightSurchargePay ?? 0) + (current.sundaySurchargePay ?? 0) + (current.holidaySurchargePay ?? 0)) -
      round2((before.nightSurchargePay ?? 0) + (before.sundaySurchargePay ?? 0) + (before.holidaySurchargePay ?? 0)),
    2,
  );
  expect(row.diffPay).toBeCloseTo(round2((current.totalPay ?? 0) - (before.totalPay ?? 0)), 2);
});
