import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Bei DEAKTIVIERTER Zeiterfassung (Konto-Schalter
 * allowance_settings.time_tracking_enabled, Standard AUS) rechnet die
 * Premium-Lohnauswertung (GET /dashboard/hours-balance) planbasiert — die
 * gesamte Geldrechnung (Grundvergütung + Zuschläge) kommt aus den geplanten
 * FIX-Schichten, auch wenn die Abrechnungsart auf IST konfiguriert ist
 * (effektive Abrechnungsart = SOLL). Bei EIN bleibt alles wie bisher (IST aus
 * bestätigten Ist-Zeiten).
 *
 * Außerdem: GET /dashboard/summary liefert bei AUS keine
 * Zeiterfassungs-Kennzahlen mehr (timeTrackingEnabled=false,
 * pendingTimeEntries/uncountedPending*=0, recentTimeEntries leer,
 * monthlyActualHours = geplante FIX-Stunden).
 *
 * Aufbau (fester Monat September 2026):
 * - Privat-Konto (Premium), Assistent mit Stundenlohn 20 EUR im Standard-Team
 *   (teamId wird bei POSTs weggelassen -> resolveWriteTeamId-Fallback).
 * - FIX-Schicht Sonntag 06.09.2026 08:00-16:00 (8h, Sonntagszuschlag 50 %).
 * - Bei EIN: bestätigte Ist-Zeit 4h am selben Sonntag + eine OFFENE Ist-Zeit.
 */

const YEAR = 2026;
const MONTH = 9;
const WAGE = 20;
const SUNDAY_PERCENT = 50;

let acc: FreeAccount;
let assistantId = 0;
let shiftId = 0;

interface BalanceRow {
  userId: number;
  billingMethod: "SOLL" | "IST";
  valuedHours: number;
  sundayHours: number;
  sundaySurchargeHours: number;
  basePay: number | null;
  sundaySurchargePay: number | null;
  totalPay: number | null;
  workedHours: number;
}

interface Summary {
  timeTrackingEnabled: boolean;
  pendingTimeEntries: number;
  monthlyPlannedHours: number;
  monthlyActualHours: number;
  uncountedPendingHours?: number;
  uncountedPendingEntries?: number;
  recentTimeEntries?: unknown[];
  warnings?: { timeTrackingConfirmable: boolean };
}

/** Schaltet die Zeiterfassung um, ohne Zuschläge/Abrechnungsart zu verändern. */
async function setTimeTracking(enabled: boolean): Promise<void> {
  const putRes = await acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: 25,
      nightStart: "23:00",
      nightEnd: "06:00",
      sundayPercent: SUNDAY_PERCENT,
      holidayPercent: 100,
      billingMethod: "IST",
      timeTrackingEnabled: enabled,
    },
  });
  expect(putRes.ok(), `PUT allowance-settings sollte 200 liefern (${putRes.status()})`).toBe(true);
  const body = (await putRes.json()) as { timeTrackingEnabled: boolean; billingMethod: string };
  expect(body.timeTrackingEnabled).toBe(enabled);
  expect(body.billingMethod, "Konfigurierter Toggle bleibt IST").toBe("IST");
}

async function fetchBalanceRow(): Promise<BalanceRow> {
  const res = await acc.ctx.get(`/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`);
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === assistantId);
  expect(row, "Zeile des Assistenten erwartet").toBeTruthy();
  return row!;
}

async function fetchSummary(): Promise<Summary> {
  const res = await acc.ctx.get(`/api/dashboard/summary?month=${MONTH}&year=${YEAR}`);
  expect(res.ok(), `dashboard/summary fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as Summary;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "ttplanlohn");
  await setAccountPlan(acc.email, "premium");

  // Assistent mit Stundenlohn im Standard-Team anlegen.
  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E TT-Plan-Lohn Assistent ${Date.now()}`,
      email: `e2e.ttplanlohn.${Date.now()}@dienstplan.test`,
      role: "assistant",
      hourlyWage: WAGE,
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // Zeiterfassung EIN + Abrechnungsart IST + Sonntag 50 %.
  await setTimeTracking(true);

  // FIX-Schicht am Sonntag, 06.09.2026, 08:00-16:00 (8h).
  const shiftRes = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      startTime: "2026-09-06T08:00:00.000Z",
      endTime: "2026-09-06T16:00:00.000Z",
      type: "active",
      planningStatus: "FIX",
    },
  });
  expect(shiftRes.ok(), `Schicht anlegen fehlgeschlagen (${shiftRes.status()})`).toBe(true);
  shiftId = ((await shiftRes.json()) as { id: number }).id;

  // Bestätigte Ist-Zeit: 4h am selben Sonntag (08:00-12:00).
  const entryRes = await acc.ctx.post("/api/time-tracking", {
    data: {
      userId: assistantId,
      actualStart: "2026-09-06T08:00:00.000Z",
      actualEnd: "2026-09-06T12:00:00.000Z",
    },
  });
  expect(entryRes.status(), `Ist-Zeit anlegen fehlgeschlagen (${entryRes.status()})`).toBe(201);
  const entryId = ((await entryRes.json()) as { id: number }).id;
  const confirmRes = await acc.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
    data: { status: "confirmed", confirmedBy: acc.id },
  });
  expect(confirmRes.ok(), `Bestätigen fehlgeschlagen (${confirmRes.status()})`).toBe(true);

  // Zusätzlich eine OFFENE Ist-Zeit (für die Dashboard-Kennzahlen).
  const pendingRes = await acc.ctx.post("/api/time-tracking", {
    data: {
      userId: assistantId,
      actualStart: "2026-09-07T08:00:00.000Z",
      actualEnd: "2026-09-07T10:00:00.000Z",
    },
  });
  expect(pendingRes.status()).toBe(201);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("EIN + IST: Lohnauswertung rechnet aus bestätigten Ist-Zeiten", async () => {
  const row = await fetchBalanceRow();
  expect(row.billingMethod).toBe("IST");
  // Nur der bestätigte 4h-Eintrag zählt (Sonntag -> 4 Sonntagsstunden).
  expect(row.valuedHours).toBeCloseTo(4, 2);
  expect(row.sundayHours).toBeCloseTo(4, 2);
  expect(row.sundaySurchargeHours).toBeCloseTo((4 * SUNDAY_PERCENT) / 100, 2);
  expect(row.basePay).toBeCloseTo(WAGE * 4, 2);
  expect(row.sundaySurchargePay).toBeCloseTo(WAGE * 2, 2);
  expect(row.totalPay).toBeCloseTo(WAGE * 6, 2);
});

test("AUS: Lohnauswertung wird planbasiert (effektiv SOLL trotz konfiguriertem IST)", async () => {
  await setTimeTracking(false);

  // Sanity: gespeicherte Roh-Kennzahlen der FIX-Schicht (Erwartungsbasis).
  const shiftRes = await acc.ctx.get(`/api/shifts/${shiftId}`);
  expect(shiftRes.ok()).toBe(true);
  const shift = (await shiftRes.json()) as { valuedHours?: number; sundayHours?: number };
  expect(shift.valuedHours ?? 0).toBeCloseTo(8, 2);
  expect(shift.sundayHours ?? 0).toBeGreaterThan(0);

  const row = await fetchBalanceRow();
  // Effektive Abrechnungsart SOLL — Geld komplett aus der geplanten FIX-Schicht.
  expect(row.billingMethod).toBe("SOLL");
  expect(row.valuedHours).toBeCloseTo(8, 2);
  expect(row.sundayHours).toBeCloseTo(shift.sundayHours ?? 0, 2);
  expect(row.sundaySurchargeHours).toBeCloseTo(((shift.sundayHours ?? 0) * SUNDAY_PERCENT) / 100, 2);
  expect(row.basePay).toBeCloseTo(WAGE * 8, 2);
  expect(row.sundaySurchargePay).toBeCloseTo(
    WAGE * (((shift.sundayHours ?? 0) * SUNDAY_PERCENT) / 100),
    2,
  );
  expect(row.totalPay).toBeCloseTo((row.basePay ?? 0) + (row.sundaySurchargePay ?? 0), 2);
});

test("AUS: Dashboard-Übersicht ohne Zeiterfassungs-Kennzahlen, Stunden planbasiert", async () => {
  const summary = await fetchSummary();
  expect(summary.timeTrackingEnabled).toBe(false);
  expect(summary.pendingTimeEntries).toBe(0);
  expect(summary.uncountedPendingHours ?? 0).toBe(0);
  expect(summary.uncountedPendingEntries ?? 0).toBe(0);
  expect(summary.recentTimeEntries ?? []).toHaveLength(0);
  expect(summary.warnings?.timeTrackingConfirmable).toBe(false);
  // Ist-Kennzahl zeigt die geplanten FIX-Stunden (planbasiert).
  expect(summary.monthlyPlannedHours).toBeCloseTo(8, 2);
  expect(summary.monthlyActualHours).toBeCloseTo(summary.monthlyPlannedHours, 2);
});

test("Wieder EIN: alles wie bisher (IST-Zahlen und offene Einträge zurück)", async () => {
  await setTimeTracking(true);

  const summary = await fetchSummary();
  expect(summary.timeTrackingEnabled).toBe(true);
  expect(summary.pendingTimeEntries).toBeGreaterThan(0);
  expect(summary.monthlyActualHours).toBeCloseTo(4, 2); // nur der bestätigte Eintrag

  const row = await fetchBalanceRow();
  expect(row.billingMethod).toBe("IST");
  expect(row.valuedHours).toBeCloseTo(4, 2);
});
