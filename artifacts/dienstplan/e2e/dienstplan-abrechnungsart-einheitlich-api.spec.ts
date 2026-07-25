import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";
import { dbSetContractBillingMethod } from "./helpers/db";

/**
 * API-Regressionstest: Die Abrechnungsart (SOLL/IST) gilt EINHEITLICH fuer alle
 * Assistenzkraefte eines Kontos/Teams — der fruehere Vertrags-Override wurde
 * entfernt (Kette nur noch Team-Override → Konto → SOLL-Default).
 *
 * Aufbau (fester Monat November 2026, Mo 9. + Di 10.: keine Sonntage, keine
 * bundesweiten Feiertage):
 * - Frisches Privat-Konto (Premium via DB-Helper), Zeiterfassung aktiv.
 * - Zwei Assistenten im Standard-Team, identisch geplant (je 1 FIX-Schicht 8h)
 *   und identisch erfasst (je 1 bestaetigte Ist-Zeit 6h).
 * - Assistent B erhaelt einen HISTORISCHEN Vertrags-Override billing_method =
 *   'IST' direkt in der DB (per API/UI ist das Feld nicht mehr setzbar).
 *
 * Erwartung:
 * - Konto auf SOLL: BEIDE Zeilen billingMethod=SOLL mit Plan-Stunden (8h) —
 *   der Alt-Wert am Vertrag von B ist wirkungslos (frueher waere B IST/6h).
 * - Konto auf IST: BEIDE Zeilen billingMethod=IST mit Ist-Stunden (6h) —
 *   die Kette Konto → Zeile funktioniert weiterhin (Regressionsschutz).
 */

const YEAR = 2026;
const MONTH = 11;

const SHIFT_A_START = "2026-11-09T08:00:00.000Z";
const SHIFT_A_END = "2026-11-09T16:00:00.000Z"; // Plan 8h
const IST_A_END = "2026-11-09T14:00:00.000Z"; // Ist 6h
const SHIFT_B_START = "2026-11-10T08:00:00.000Z";
const SHIFT_B_END = "2026-11-10T16:00:00.000Z"; // Plan 8h
const IST_B_END = "2026-11-10T14:00:00.000Z"; // Ist 6h

let acc: FreeAccount;
let assistantAId = 0;
let assistantBId = 0;

interface BalanceRow {
  userId: number;
  billingMethod: "SOLL" | "IST";
  valuedHours: number;
  plannedHours: number;
}

async function setAccountBilling(method: "SOLL" | "IST"): Promise<void> {
  const res = await acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: 25,
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
  expect(body.timeTrackingEnabled).toBe(true);
}

async function fetchRows(): Promise<Map<number, BalanceRow>> {
  const res = await acc.ctx.get(`/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`);
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  return new Map(rows.map((r) => [r.userId, r]));
}

async function createAssistant(label: string): Promise<number> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Einheitlich ${label}`,
      email: `e2e.einheitlich.${label}.${stamp}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.status(), `Assistent ${label} anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createContract(userId: number): Promise<number> {
  const res = await acc.ctx.post("/api/contracts", {
    data: {
      userId,
      weeklyHours: 40,
      vacationDays: 30,
      startDate: "2026-01-01",
    },
  });
  expect(res.status(), `Vertrag anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createFixShift(userId: number, start: string, end: string): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId,
      startTime: start,
      endTime: end,
      type: "work",
      planningStatus: "FIX",
    },
  });
  expect(res.status(), `Schicht anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createConfirmedEntry(
  userId: number,
  shiftId: number,
  actualStart: string,
  actualEnd: string,
): Promise<void> {
  const res = await acc.ctx.post("/api/time-tracking", {
    data: { userId, shiftId, actualStart, actualEnd },
  });
  expect(res.status(), `Ist-Zeit anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  const entryId = ((await res.json()) as { id: number }).id;
  const confirmRes = await acc.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
    data: { status: "confirmed" },
  });
  expect(confirmRes.ok(), `Ist-Zeit bestaetigen fehlgeschlagen (${confirmRes.status()})`).toBe(true);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "einheitlich");
  await setAccountPlan(acc.email, "premium");
  await setAccountBilling("SOLL");

  assistantAId = await createAssistant("a");
  assistantBId = await createAssistant("b");

  await createContract(assistantAId);
  const contractBId = await createContract(assistantBId);
  // Historischen Vertrags-Override nachstellen (API/UI koennen das Feld nicht
  // mehr setzen) — er darf die Auswertung NICHT mehr beeinflussen.
  await dbSetContractBillingMethod(contractBId, "IST");

  const shiftAId = await createFixShift(assistantAId, SHIFT_A_START, SHIFT_A_END);
  const shiftBId = await createFixShift(assistantBId, SHIFT_B_START, SHIFT_B_END);
  await createConfirmedEntry(assistantAId, shiftAId, SHIFT_A_START, IST_A_END);
  await createConfirmedEntry(assistantBId, shiftBId, SHIFT_B_START, IST_B_END);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Konto SOLL: Vertrags-Altwert IST an Assistent B ist wirkungslos — beide Zeilen SOLL/8h", async () => {
  await setAccountBilling("SOLL");
  const rows = await fetchRows();
  const rowA = rows.get(assistantAId)!;
  const rowB = rows.get(assistantBId)!;
  expect(rowA, "Zeile Assistent A erwartet").toBeTruthy();
  expect(rowB, "Zeile Assistent B erwartet").toBeTruthy();

  expect(rowA.billingMethod).toBe("SOLL");
  expect(rowB.billingMethod, "Alt-Vertragswert IST darf nicht mehr greifen").toBe("SOLL");
  expect(rowA.valuedHours).toBeCloseTo(8, 2);
  expect(rowB.valuedHours, "B muss identisch (plan-basiert) gewertet werden").toBeCloseTo(8, 2);
});

test("Konto IST: Kette Konto → Zeile greift weiterhin fuer BEIDE Assistenten — 6h Ist", async () => {
  await setAccountBilling("IST");
  const rows = await fetchRows();
  const rowA = rows.get(assistantAId)!;
  const rowB = rows.get(assistantBId)!;

  expect(rowA.billingMethod).toBe("IST");
  expect(rowB.billingMethod).toBe("IST");
  expect(rowA.valuedHours).toBeCloseTo(6, 2);
  expect(rowB.valuedHours).toBeCloseTo(6, 2);
});
