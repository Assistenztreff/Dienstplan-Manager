import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Regressionstest: Die Nachberechnung (GET /month-closings/diff) weist je
 * Assistenzkraft den Abwesenheits-Anteil (Lohnfortzahlung) aus — Urlaubs- und
 * Krankheitsstunden im AKTUELLEN Stand des abgeschlossenen Monats plus deren
 * Geldwert (Stundenlohn × gewertete Stunden, identisch zur Lohnfortzahlung
 * der Lohnauswertung).
 *
 * Aufbau (fester Monat März; im Jan/Feb weicht der Test ins Vorjahr aus):
 * - Frisches Premium-Privat-Konto, Assistent mit Stundenlohn 20 EUR,
 *   Abrechnungsart SOLL (Zeiterfassung bleibt AUS — Default).
 * - FIX-Arbeitsdienst, dann Monatsabschluss (Diff leer).
 * - NACH dem Abschluss: ganztägiger Urlaub + ganztägige Krankheit ->
 *   der Diff muss die Abwesenheits-Stunden/-Geldwerte exakt aus der
 *   aktuellen Lohnauswertung tragen.
 */

const MONTH = 3;
const now = new Date();
const YEAR = now.getMonth() + 1 > MONTH ? now.getFullYear() : now.getFullYear() - 1;
const WAGE = 20;

const q = `month=${MONTH}&year=${YEAR}`;

type BalanceRow = {
  userId: number;
  totalFulfilledHours: number;
  vacationFulfilledHours: number;
  sickHours: number;
  hourlyWage: number | null;
  totalPay: number | null;
};

type DiffRow = {
  userId: number;
  diffHours: number;
  vacationHours?: number;
  vacationPay?: number | null;
  sickHours?: number;
  sickPay?: number | null;
};

type Diff = { closed: boolean; rows: DiffRow[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

let acc: FreeAccount;
let assistantId = 0;
let workShiftId = 0;

function localIso(day: string, time: string): string {
  return new Date(`${YEAR}-03-${day}T${time}:00`).toISOString();
}

async function createShift(
  type: "work" | "vacation" | "sick",
  startIso: string,
  endIso: string,
): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: assistantId,
      type,
      planningStatus: "FIX",
      force: true,
      startTime: startIso,
      endTime: endIso,
    },
  });
  expect(res.status(), `Schicht (${type}) anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
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

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "abschluss-abw");
  await setAccountPlan(acc.email, "premium");

  const userRes = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Abschluss-Abw Assistent ${Date.now()}`,
      email: `e2e.abschluss.abw.${Date.now()}@dienstplan.test`,
      role: "assistant",
      hourlyWage: WAGE,
    },
  });
  expect(userRes.status(), "Assistent sollte 201 liefern").toBe(201);
  assistantId = ((await userRes.json()) as { id: number }).id;

  // FIX-Arbeitsdienst Di 10.03 08–16 (SOLL-Basis vor dem Abschluss).
  workShiftId = await createShift("work", localIso("10", "08:00"), localIso("10", "16:00"));
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Abschluss ohne Abwesenheiten: Diff leer", async () => {
  const res = await acc.ctx.post("/api/month-closings", { data: { month: MONTH, year: YEAR } });
  expect(res.status(), `Abschließen (${res.status()})`).toBe(201);
  const diff = await fetchDiff();
  expect(diff.closed).toBe(true);
  expect(diff.rows).toEqual([]);
});

test("Nachträgliche Abwesenheiten: Diff weist Urlaubs-/Krank-Anteil mit Geldwert aus", async () => {
  // Ganztägiger Urlaub (12.03) + ganztägige Krankheit (13.03) NACH dem Abschluss.
  await createShift("vacation", localIso("12", "00:00"), localIso("12", "23:59"));
  await createShift("sick", localIso("13", "00:00"), localIso("13", "23:59"));

  const current = await fetchBalanceRow();
  // Sanity: die Lohnfortzahlung muss in der aktuellen Auswertung ankommen,
  // sonst prüft der Test den Abwesenheits-Ausweis nicht wirklich.
  expect(current.vacationFulfilledHours, "Urlaubs-Stunden erwartet").toBeGreaterThan(0);
  expect(current.sickHours, "Krankheits-Stunden erwartet").toBeGreaterThan(0);
  expect(current.hourlyWage).toBeCloseTo(WAGE, 2);

  const diff = await fetchDiff();
  expect(diff.closed).toBe(true);
  expect(diff.rows).toHaveLength(1);
  const row = diff.rows[0];
  expect(row.userId).toBe(assistantId);

  // Abwesenheits-Ausweis = AKTUELLER Stand der Lohnauswertung.
  expect(row.vacationHours).toBeCloseTo(round2(current.vacationFulfilledHours), 2);
  expect(row.sickHours).toBeCloseTo(round2(current.sickHours), 2);
  // Geldwert = Stundenlohn × gewertete Stunden (Lohnfortzahlungs-Logik).
  expect(row.vacationPay).toBeCloseTo(round2(WAGE * current.vacationFulfilledHours), 2);
  expect(row.sickPay).toBeCloseTo(round2(WAGE * current.sickHours), 2);

  // Die Vorzeichenlogik der Differenz bleibt unverändert: Abwesenheiten
  // erhöhen die erfüllten Stunden gegenüber dem eingefrorenen Stand.
  expect(row.diffHours).toBeCloseTo(
    round2(current.vacationFulfilledHours + current.sickHours),
    2,
  );
});

test("Stundenneutrale Umwandlung Dienst -> Krankheit bleibt im Abwesenheits-Ausweis sichtbar", async () => {
  // Frischer Abschluss (Schnappschuss kennt jetzt die Abwesenheitsfelder).
  const closeRes = await acc.ctx.post("/api/month-closings", {
    data: { month: MONTH, year: YEAR },
  });
  expect(closeRes.status(), `Erneut abschließen (${closeRes.status()})`).toBe(201);
  const emptyDiff = await fetchDiff();
  expect(emptyDiff.rows, "Diff direkt nach Abschluss leer").toEqual([]);

  const before = await fetchBalanceRow();

  // Arbeitsdienst 10.03 (08–16, 8h) in Krankheit umwandeln — gleiche Zeiten,
  // gleicher Geldwert (Lohnfortzahlung): Stunden und Pay bleiben neutral.
  const patchRes = await acc.ctx.patch(`/api/shifts/${workShiftId}`, {
    data: { type: "sick", planningStatus: "FIX", force: true },
  });
  expect(patchRes.ok(), `Umwandlung fehlgeschlagen (${patchRes.status()})`).toBe(true);

  const after = await fetchBalanceRow();
  // Sanity: die Umwandlung ist tatsächlich stundenneutral …
  expect(after.totalFulfilledHours).toBeCloseTo(before.totalFulfilledHours, 2);
  expect(after.totalPay ?? 0).toBeCloseTo(before.totalPay ?? 0, 2);
  // … verschiebt aber 8h in die Krankheits-Lohnfortzahlung.
  expect(after.sickHours).toBeCloseTo(round2(before.sickHours + 8), 2);

  // Der Diff muss die Zeile TROTZ neutraler Stunden/Geldwerte liefern.
  const diff = await fetchDiff();
  expect(diff.rows).toHaveLength(1);
  const row = diff.rows[0];
  expect(row.userId).toBe(assistantId);
  expect(row.diffHours).toBeCloseTo(0, 2);
  expect(row.sickHours).toBeCloseTo(round2(after.sickHours), 2);
  expect(row.sickPay).toBeCloseTo(round2(WAGE * after.sickHours), 2);
  expect(row.vacationHours).toBeCloseTo(round2(after.vacationFulfilledHours), 2);
});
