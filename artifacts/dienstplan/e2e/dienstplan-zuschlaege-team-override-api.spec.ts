import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Regressionstest: Team-Overrides der Zuschlags-Einstellungen
 * (allowance_settings mit team_id) muessen in der Premium-Lohnauswertung
 * (GET /dashboard/hours-balance) die GELDBETRAEGE bestimmen — abweichende
 * Prozente UND ein abweichendes Nachtfenster je Team, mit Fallback-Kette
 * Team-Override -> Konto des Team-Eigentuemers -> Defaults.
 *
 * Nicht abgedeckt war bisher genau dieser Pfad: Die bestehende Regression
 * (dienstplan-lohnauswertung-ist-modus-api.spec.ts) rechnet ausschliesslich
 * mit den Konto-Standardwerten (25 %, Fenster 23-06). Ein Fehler in der
 * Override-Aufloesung (percentsFor/teamMetaByTeam in
 * hours-balance-service.ts) wuerde falsche Nachtzuschlags-Betraege liefern,
 * ohne dass ein Test rot wird.
 *
 * Aufbau (fester Monat Oktober 2026, Mo 12.10. -> Di 13.10., kein Sonntag,
 * kein bundesweiter Feiertag):
 * - Frisches DIENSTLEISTER-Konto (Premium via DB-Helper) mit zwei Teams:
 *   Standard-Team A MIT Override (Nacht 40 %, Fenster 22-05) und Team B
 *   OHNE Override (Konto-Werte: Nacht 25 %, Fenster 23-06).
 * - Je Team ein Assistent (Stundenlohn 20 EUR) mit identischer Nachtschicht
 *   21:00-05:00 (FIX) und einer BESTAETIGTEN, plan-deckungsgleichen Ist-Zeit.
 * - Identische Ist- und Plan-Zeiten => im IST-Modus liefern die neu aus dem
 *   jeweiligen Team-Nachtfenster berechneten Metriken exakt die gespeicherten
 *   Kennzahlen der Schicht — die Erwartungswerte kommen daher fuer BEIDE Modi
 *   aus GET /api/shifts/:id (keine Duplikation der Bewertungs-Engine, keine
 *   Zeitzonen-Annahmen).
 *
 * Das Fenster-Signal: Bei identischen Schichtzeiten unterscheiden sich die
 * gespeicherten Nachtstunden der beiden Teams genau dann, wenn beim Speichern
 * das jeweilige Team-Fenster (22-05 vs. 23-06) angewandt wurde.
 */

const YEAR = 2026;
const MONTH = 10;
const WAGE = 20;
const ACCOUNT_NIGHT_PERCENT = 25;
const OVERRIDE_NIGHT_PERCENT = 40;

// Mo 12.10.2026 21:00 bis Di 13.10.2026 05:00 (8h Nachtschicht).
const SHIFT_START = "2026-10-12T21:00:00.000Z";
const SHIFT_END = "2026-10-13T05:00:00.000Z";

let acc: FreeAccount;
let teamAId = 0; // Standard-Team MIT Override
let teamBId = 0; // zweites Team OHNE Override
let assistantAId = 0;
let assistantBId = 0;
let shiftAId = 0;
let shiftBId = 0;

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
  nightSurchargeHours: number;
  nightPercent: number;
  hourlyWage: number | null;
  basePay: number | null;
  nightSurchargePay: number | null;
  sundaySurchargePay: number | null;
  holidaySurchargePay: number | null;
  totalPay: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Abrechnungsart umschalten — auf der KONTO-Zeile UND im Team-A-Override,
 * denn die Override-Zeile traegt eine eigene billingMethod, die in der
 * Fallback-Kette VOR dem Konto greift. Prozente/Fenster bleiben unveraendert
 * auf den bekannten Testwerten.
 */
async function setBillingMethod(method: "SOLL" | "IST"): Promise<void> {
  const accountRes = await acc.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: ACCOUNT_NIGHT_PERCENT,
      nightStart: "23:00",
      nightEnd: "06:00",
      sundayPercent: 50,
      holidayPercent: 100,
      billingMethod: method,
      timeTrackingEnabled: true,
    },
  });
  expect(accountRes.ok(), `PUT Konto-Einstellungen fehlgeschlagen (${accountRes.status()})`).toBe(true);
  const overrideRes = await acc.ctx.put(`/api/allowance-settings?teamId=${teamAId}`, {
    data: {
      nightPercent: OVERRIDE_NIGHT_PERCENT,
      nightStart: "22:00",
      nightEnd: "05:00",
      sundayPercent: 50,
      holidayPercent: 100,
      billingMethod: method,
    },
  });
  expect(overrideRes.ok(), `PUT Team-Override fehlgeschlagen (${overrideRes.status()})`).toBe(true);
  const body = (await overrideRes.json()) as { isOverride: boolean; nightPercent: number };
  expect(body.isOverride, "Team A muss eine Override-Zeile tragen").toBe(true);
  expect(body.nightPercent).toBe(OVERRIDE_NIGHT_PERCENT);
}

async function fetchShift(id: number): Promise<ShiftMetrics> {
  const res = await acc.ctx.get(`/api/shifts/${id}`);
  expect(res.ok(), `GET /api/shifts/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as ShiftMetrics;
}

async function fetchBalanceRow(teamId: number, userId: number): Promise<BalanceRow> {
  const res = await acc.ctx.get(
    `/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}&teamId=${teamId}`,
  );
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === userId);
  expect(row, `Zeile des Assistenten ${userId} in Team ${teamId} erwartet`).toBeTruthy();
  return row!;
}

async function createAssistant(teamId: number, label: string): Promise<number> {
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E Override ${label} ${Date.now()}`,
      email: `e2e.override.${label}.${Date.now()}@dienstplan.test`,
      role: "assistant",
      teamId,
      hourlyWage: WAGE,
    },
  });
  expect(res.status(), `Assistent ${label} sollte 201 liefern`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createNightShift(teamId: number, userId: number): Promise<number> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId,
      teamId,
      type: "active",
      planningStatus: "FIX",
      startTime: SHIFT_START,
      endTime: SHIFT_END,
    },
  });
  expect(res.status(), `Schicht anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createConfirmedEntry(userId: number, shiftId: number): Promise<void> {
  const res = await acc.ctx.post("/api/time-tracking", {
    data: { userId, shiftId, actualStart: SHIFT_START, actualEnd: SHIFT_END },
  });
  expect(res.status(), `Ist-Zeit anlegen fehlgeschlagen (${res.status()})`).toBe(201);
  const entryId = ((await res.json()) as { id: number }).id;
  const confirmRes = await acc.ctx.patch(`/api/time-tracking/${entryId}/confirm`, {
    data: { status: "confirmed" },
  });
  expect(confirmRes.ok(), `Bestaetigen fehlgeschlagen (${confirmRes.status()})`).toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("dienstleister", "teamzuschlag");
  await setAccountPlan(acc.email, "premium");

  // Standard-Team des Dienstleisters ermitteln + zweites Team anlegen.
  const teamsRes = await acc.ctx.get("/api/teams");
  expect(teamsRes.ok(), `GET /api/teams fehlgeschlagen (${teamsRes.status()})`).toBe(true);
  const teams = (await teamsRes.json()) as Array<{ id: number }>;
  expect(teams.length, "Registrierung muss ein Standard-Team anlegen").toBeGreaterThan(0);
  teamAId = teams[0].id;
  const teamBRes = await acc.ctx.post("/api/teams", {
    data: { name: `E2E Ohne Override ${Date.now()}` },
  });
  expect(teamBRes.status(), "Team B sollte 201 liefern").toBe(201);
  teamBId = ((await teamBRes.json()) as { id: number }).id;

  // Konto-Einstellungen (25 %, Fenster 23-06, Zeiterfassung EIN) und
  // Team-A-Override (40 %, Fenster 22-05) VOR dem Anlegen der Schichten
  // setzen — das Nachtfenster wird beim Speichern der Schicht angewandt.
  await setBillingMethod("SOLL");

  assistantAId = await createAssistant(teamAId, "a");
  assistantBId = await createAssistant(teamBId, "b");

  shiftAId = await createNightShift(teamAId, assistantAId);
  shiftBId = await createNightShift(teamBId, assistantBId);

  await createConfirmedEntry(assistantAId, shiftAId);
  await createConfirmedEntry(assistantBId, shiftBId);
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test("Sanity: identische Schichtzeiten, aber unterschiedliche Nachtstunden je Team-Fenster", async () => {
  const a = await fetchShift(shiftAId);
  const b = await fetchShift(shiftBId);

  expect(a.valuedHours ?? 0).toBeCloseTo(8, 2);
  expect(b.valuedHours ?? 0).toBeCloseTo(8, 2);
  expect(a.nightHours ?? 0, "Team A muss Nachtstunden tragen").toBeGreaterThan(0);
  expect(b.nightHours ?? 0, "Team B muss Nachtstunden tragen").toBeGreaterThan(0);
  // Das eigentliche Fenster-Signal: 22-05 (Override) vs. 23-06 (Konto)
  // bewerten dieselbe Schicht 21:00-05:00 unterschiedlich — waere beim
  // Speichern faelschlich dasselbe Fenster angewandt worden, waeren die
  // Nachtstunden identisch.
  expect(
    Math.abs((a.nightHours ?? 0) - (b.nightHours ?? 0)),
    "Override-Nachtfenster muss andere Nachtstunden liefern als das Konto-Fenster",
  ).toBeGreaterThan(0.5);
  for (const s of [a, b]) {
    expect(s.sundayHours ?? 0).toBeCloseTo(0, 2);
    expect(s.holidayHours ?? 0).toBeCloseTo(0, 2);
  }
});

test("SOLL-Modus: Team-Override-Prozente/-Fenster bestimmen den Nachtzuschlags-Betrag, Team ohne Override faellt aufs Konto zurueck", async () => {
  await setBillingMethod("SOLL");
  const a = await fetchShift(shiftAId);
  const b = await fetchShift(shiftBId);

  const rowA = await fetchBalanceRow(teamAId, assistantAId);
  expect(rowA.billingMethod).toBe("SOLL");
  expect(rowA.hourlyWage).toBeCloseTo(WAGE, 2);
  // Angezeigte Prozente muessen der tatsaechlich angewandten Kette entsprechen.
  expect(rowA.nightPercent, "Team A muss die Override-Prozente anzeigen").toBe(OVERRIDE_NIGHT_PERCENT);
  expect(rowA.basePay, "Grundvergütung Team A").toBeCloseTo(round2(WAGE * (a.valuedHours ?? 0)), 2);
  const expectedHoursA = (a.nightHours ?? 0) * (OVERRIDE_NIGHT_PERCENT / 100);
  expect(rowA.nightSurchargeHours, "Zuschlags-Stunden Team A (40 %)").toBeCloseTo(expectedHoursA, 2);
  expect(rowA.nightSurchargePay, "Nachtzuschlags-Betrag Team A (40 %)").toBeCloseTo(
    round2(expectedHoursA * WAGE),
    2,
  );
  expect(rowA.sundaySurchargePay ?? 0).toBeCloseTo(0, 2);
  expect(rowA.holidaySurchargePay ?? 0).toBeCloseTo(0, 2);
  expect(rowA.totalPay).toBeCloseTo(round2((rowA.basePay ?? 0) + (rowA.nightSurchargePay ?? 0)), 2);

  const rowB = await fetchBalanceRow(teamBId, assistantBId);
  expect(rowB.billingMethod).toBe("SOLL");
  expect(rowB.nightPercent, "Team B muss die Konto-Prozente anzeigen").toBe(ACCOUNT_NIGHT_PERCENT);
  expect(rowB.basePay, "Grundvergütung Team B").toBeCloseTo(round2(WAGE * (b.valuedHours ?? 0)), 2);
  const expectedHoursB = (b.nightHours ?? 0) * (ACCOUNT_NIGHT_PERCENT / 100);
  expect(rowB.nightSurchargeHours, "Zuschlags-Stunden Team B (25 %)").toBeCloseTo(expectedHoursB, 2);
  expect(rowB.nightSurchargePay, "Nachtzuschlags-Betrag Team B (25 %)").toBeCloseTo(
    round2(expectedHoursB * WAGE),
    2,
  );
  expect(rowB.totalPay).toBeCloseTo(round2((rowB.basePay ?? 0) + (rowB.nightSurchargePay ?? 0)), 2);
});

test("IST-Modus: Ist-Zeiten werden mit dem Team-Nachtfenster neu bewertet und mit den Team-Prozenten bezahlt", async () => {
  await setBillingMethod("IST");
  const a = await fetchShift(shiftAId);
  const b = await fetchShift(shiftBId);

  // Ist-Zeiten sind plan-deckungsgleich: Die im IST-Modus je Eintrag NEU aus
  // dem Team-Nachtfenster berechneten Nachtstunden muessen exakt den beim
  // Speichern der Schicht ermittelten entsprechen.
  const rowA = await fetchBalanceRow(teamAId, assistantAId);
  expect(rowA.billingMethod).toBe("IST");
  expect(rowA.valuedHours, "IST-Stunden Team A aus der Ist-Zeit").toBeCloseTo(a.valuedHours ?? 0, 2);
  expect(rowA.nightPercent).toBe(OVERRIDE_NIGHT_PERCENT);
  expect(rowA.basePay, "IST-Grundvergütung Team A").toBeCloseTo(round2(WAGE * (a.valuedHours ?? 0)), 2);
  const expectedHoursA = (a.nightHours ?? 0) * (OVERRIDE_NIGHT_PERCENT / 100);
  expect(rowA.nightSurchargeHours, "IST-Zuschlags-Stunden Team A (Fenster 22-05, 40 %)").toBeCloseTo(
    expectedHoursA,
    2,
  );
  expect(rowA.nightSurchargePay, "IST-Nachtzuschlags-Betrag Team A").toBeCloseTo(
    round2(expectedHoursA * WAGE),
    2,
  );
  expect(rowA.totalPay).toBeCloseTo(round2((rowA.basePay ?? 0) + (rowA.nightSurchargePay ?? 0)), 2);

  const rowB = await fetchBalanceRow(teamBId, assistantBId);
  expect(rowB.billingMethod).toBe("IST");
  expect(rowB.valuedHours, "IST-Stunden Team B aus der Ist-Zeit").toBeCloseTo(b.valuedHours ?? 0, 2);
  expect(rowB.nightPercent).toBe(ACCOUNT_NIGHT_PERCENT);
  expect(rowB.basePay, "IST-Grundvergütung Team B").toBeCloseTo(round2(WAGE * (b.valuedHours ?? 0)), 2);
  const expectedHoursB = (b.nightHours ?? 0) * (ACCOUNT_NIGHT_PERCENT / 100);
  expect(rowB.nightSurchargeHours, "IST-Zuschlags-Stunden Team B (Fenster 23-06, 25 %)").toBeCloseTo(
    expectedHoursB,
    2,
  );
  expect(rowB.nightSurchargePay, "IST-Nachtzuschlags-Betrag Team B").toBeCloseTo(
    round2(expectedHoursB * WAGE),
    2,
  );
  expect(rowB.totalPay).toBeCloseTo(round2((rowB.basePay ?? 0) + (rowB.nightSurchargePay ?? 0)), 2);
});
