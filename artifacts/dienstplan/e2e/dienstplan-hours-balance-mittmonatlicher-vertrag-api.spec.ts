import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-E2E-Beweis: Die Urlaubsspalten der Lohnauswertung
 * (GET /api/dashboard/hours-balance) finden auch einen Vertrag, der erst
 * MITTEN im ausgewerteten Monat beginnt.
 *
 * Hintergrund (Bug): Der Vertrags-Lookup suchte den aktiven Vertrag zum
 * MONATSERSTEN. Begann der Vertrag z. B. am 15., wurde kein Vertrag gefunden
 * und die Spalten "Urlaub genommen/verbleibend" fielen still auf 0 bzw. den
 * vollen Standard-Anspruch zurueck — obwohl der Stundenzaehler
 * (contracts.vacationHoursUsed) korrekt gebucht war.
 *
 * Abgesichert wird:
 * - Vertrag ab Monatsmitte + Urlaub im selben Monat -> vacationDaysUsed /
 *   vacationDaysRemaining korrekt (konsistent mit /contracts/:id/vacation-balance).
 * - Multi-Team: Bei Vertraegen in mehreren Teams zieht der ausgewertete
 *   Team-Scope den Vertrag SEINES Teams heran (kein teamfremder Vertrag).
 * - Ungueltiger month-Parameter (z. B. "2026-07") -> 400 statt 500.
 *
 * Alle Daten liegen 8 Monate zurueck (relativ zum Testlauf), damit weder
 * Vorausplanungs-Limits noch der Urlaubs-Vertragszeitraum-Guard stoeren UND
 * die Wartezeit-Regelung fuer den Urlaubssockel (§ 4 BUrlG, > 6 volle
 * Beschaeftigungsmonate) den vollen Jahresanspruch bereits freigegeben hat —
 * dieses Spec prueft den Vertrags-Lookup, nicht die Wartezeit-Proration.
 */

function monthShift(deltaMonths: number, day: number): string {
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth() + deltaMonths, day);
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  return `${t.getFullYear()}-${mm}-${dd}`;
}

// Ausgewerteter Monat = vor 8 Monaten; Vertrag beginnt am 15., Urlaub am 20.
const CONTRACT_START = monthShift(-8, 15);
const VACATION_DAY = monthShift(-8, 20);
const EVAL_YEAR = Number(CONTRACT_START.split("-")[0]);
const EVAL_MONTH = Number(CONTRACT_START.split("-")[1]);

function fullDayIso(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

interface BalanceRow {
  userId: number;
  vacationDaysUsed: number;
  vacationDaysRemaining: number;
}

let h: TeamTestHarness;
let teamA: number;
let teamB: number;
let assistant: number;
let contractAId: number;

async function balanceRow(teamId: number, userId: number): Promise<BalanceRow> {
  const res = await h.ctx.get(
    `/api/dashboard/hours-balance?month=${EVAL_MONTH}&year=${EVAL_YEAR}&teamId=${teamId}`,
  );
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as BalanceRow[];
  const row = rows.find((r) => r.userId === userId);
  expect(row, "Zeile des Assistenten fehlt in der Auswertung").toBeTruthy();
  return row!;
}

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  teamA = await h.createTeam("E2E MMV Team A");
  teamB = await h.createTeam("E2E MMV Team B");
  assistant = await h.createUser({ teamId: teamA, role: "assistant" });
  const addRes = await h.ctx.post(`/api/teams/${teamB}/members`, {
    data: { userId: assistant },
  });
  expect(addRes.ok(), "Mitgliedschaft in Team B fehlgeschlagen").toBe(true);

  // Beide Vertraege beginnen MITTEN im ausgewerteten Monat — vor dem Fix fand
  // der Monatserster-Lookup keinen davon. Unterschiedliche Urlaubstage machen
  // erkennbar, welcher Vertrag pro Team-Scope herangezogen wurde.
  contractAId = await h.createContract(teamA, assistant, {
    startDate: CONTRACT_START,
    vacationDays: 30,
  });
  await h.createContract(teamB, assistant, {
    startDate: CONTRACT_START,
    vacationDays: 20,
  });

  // Ganztaegiger Urlaub (8h = 1,0 Tag) in Team A, im ausgewerteten Monat.
  const vacRes = await h.ctx.post("/api/shifts", {
    data: { userId: assistant, teamId: teamA, type: "vacation", ...fullDayIso(VACATION_DAY) },
  });
  expect(vacRes.status(), `Urlaub anlegen fehlgeschlagen (${vacRes.status()})`).toBe(201);
});

test.afterAll(async () => {
  await h.cleanup();
});

test("Mittmonatlich startender Vertrag: Urlaubsspalten zeigen den Verbrauch", async () => {
  const row = await balanceRow(teamA, assistant);
  // 8h Urlaub / 8h pro Tag = 1,0 Tag genommen, 29 von 30 verbleibend.
  expect(row.vacationDaysUsed).toBe(1);
  expect(row.vacationDaysRemaining).toBe(29);
});

test("Auswertung ist konsistent mit /contracts/:id/vacation-balance", async () => {
  const res = await h.ctx.get(`/api/contracts/${contractAId}/vacation-balance`);
  expect(res.ok(), `vacation-balance fehlgeschlagen (${res.status()})`).toBe(true);
  const balance = (await res.json()) as {
    vacationDaysUsed: number;
    vacationDaysRemaining: number;
  };
  const row = await balanceRow(teamA, assistant);
  expect(row.vacationDaysUsed).toBe(balance.vacationDaysUsed);
  expect(row.vacationDaysRemaining).toBe(balance.vacationDaysRemaining);
});

test("Multi-Team: Team-Scope zieht den Vertrag des eigenen Teams heran", async () => {
  // Team B hat einen eigenen Vertrag (20 Tage) ohne gebuchten Urlaub — die
  // Auswertung von Team B darf NICHT den Team-A-Vertrag (30 Tage, 1 Tag
  // verbraucht) heranziehen.
  const row = await balanceRow(teamB, assistant);
  expect(row.vacationDaysUsed).toBe(0);
  expect(row.vacationDaysRemaining).toBe(20);
});

test("Ungueltiger month-Parameter liefert 400 statt 500", async () => {
  const res = await h.ctx.get(
    `/api/dashboard/hours-balance?month=${EVAL_YEAR}-${String(EVAL_MONTH).padStart(2, "0")}&year=${EVAL_YEAR}`,
  );
  expect(res.status(), "month im Format YYYY-MM muss 400 liefern").toBe(400);

  const res2 = await h.ctx.get("/api/dashboard/hours-balance?month=13");
  expect(res2.status(), "month=13 muss 400 liefern").toBe(400);
});
