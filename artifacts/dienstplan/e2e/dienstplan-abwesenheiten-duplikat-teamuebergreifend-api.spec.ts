import { test, expect, type APIRequestContext } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-Test für den TEAMÜBERGREIFENDEN Schutz gegen doppelte Abwesenheiten.
 *
 * findDuplicateAbsence (artifacts/api-server/src/routes/shifts.ts) prüft bewusst
 * userübergreifend über ALLE Teams: Urlaub gehört zur Person, nicht zum Team.
 * Der bestehende Test dienstplan-abwesenheiten-duplikat-api.spec.ts deckt nur den
 * Fall innerhalb EINES Teams ab. Dieser Test sichert ab, dass ein zweiter
 * Urlaubseintrag am selben Tag auch dann mit 409 "absence_duplicate" abgelehnt
 * wird, wenn er über ein ANDERES Team desselben Dienstleisters angelegt wird —
 * sonst ließe sich der Urlaubsanspruch über mehrere Teams doppelt verbrauchen.
 *
 * Ablauf:
 * - Assistent ist Mitglied in Team A und Team B desselben Dienstleisters.
 * - Vertrag (für vacationDaysUsed-Tracking) im Team A.
 * - Urlaub am Tag X über Team A -> 201, vacationDaysUsed = 1.
 * - Identischer Urlaub am Tag X über Team B (body.teamId = Team B) -> 409
 *   "absence_duplicate" mit existingShiftId der ersten Schicht; KEIN zweiter
 *   Eintrag, vacationDaysUsed unverändert.
 */

const YEAR = new Date().getFullYear();
const CONTRACT_START = `${YEAR}-01-01`;
// Einzelner Tag mitten im Jahr, robust gegen Vertrags-/Jahresgrenzen.
const ABSENCE_DAY = `${YEAR}-06-15`;
const START_ISO = new Date(`${ABSENCE_DAY}T00:00:00`).toISOString();
const END_ISO = new Date(`${ABSENCE_DAY}T23:59:59`).toISOString();

type Contract = { id: number; userId: number; vacationDays: number; vacationDaysUsed: number };
type Shift = { id: number; userId: number; type: string };

let h: TeamTestHarness;
let teamA: number;
let teamB: number;
let assistant: number;
let contractId: number;

function vacationPayload(teamId: number) {
  return {
    userId: assistant,
    teamId,
    type: "vacation",
    startTime: START_ISO,
    endTime: END_ISO,
  };
}

async function vacationDaysUsed(ctx: APIRequestContext): Promise<number> {
  const res = await ctx.get(`/api/contracts?userId=${assistant}`);
  expect(res.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await res.json()) as Contract[];
  const contract = contracts.find((c) => c.id === contractId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  return contract!.vacationDaysUsed;
}

async function vacationShiftCount(ctx: APIRequestContext): Promise<number> {
  const res = await ctx.get(`/api/shifts?type=vacation&userId=${assistant}`);
  expect(res.ok(), "GET /api/shifts (vacation) fehlgeschlagen").toBe(true);
  const shifts = (await res.json()) as Shift[];
  return shifts.filter((s) => s.userId === assistant).length;
}

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  teamA = await h.createTeam("E2E Duplikat Team A");
  teamB = await h.createTeam("E2E Duplikat Team B");

  // Assistent zunächst Mitglied in Team A, dann zusätzlich in Team B.
  assistant = await h.createUser({ role: "assistant", teamId: teamA });
  const memberRes = await h.ctx.post(`/api/teams/${teamB}/members`, {
    data: { userId: assistant },
  });
  expect(memberRes.ok(), "Assistent zu Team B hinzufügen fehlgeschlagen").toBe(true);

  // Vertrag im Team A für das vacationDaysUsed-Tracking.
  contractId = await h.createContract(teamA, assistant, {
    startDate: CONTRACT_START,
    weeklyHours: 40,
    vacationDays: 30,
  });
});

test.afterAll(async () => {
  await h.cleanup();
});

test("POST /api/shifts lehnt teamübergreifend doppelte Urlaubstage mit 409 ab, ohne Doppelabzug", async () => {
  // --- Urlaub am Tag X über Team A: wird angelegt (201) ---
  const firstRes = await h.ctx.post("/api/shifts", { data: vacationPayload(teamA) });
  expect(firstRes.status(), "Urlaub über Team A sollte 201 liefern").toBe(201);
  const firstShift = (await firstRes.json()) as Shift;

  expect(await vacationDaysUsed(h.ctx)).toBe(1);
  expect(await vacationShiftCount(h.ctx)).toBe(1);

  // --- Identischer Urlaub am Tag X über Team B: 409 absence_duplicate ---
  const dupRes = await h.ctx.post("/api/shifts", { data: vacationPayload(teamB) });
  expect(dupRes.status(), "Zweiter Urlaub über Team B sollte 409 liefern").toBe(409);
  const dupBody = (await dupRes.json()) as { code?: string; existingShiftId?: number };
  expect(dupBody.code).toBe("absence_duplicate");
  // Verweist auf die bereits existierende Schicht aus Team A.
  expect(dupBody.existingShiftId).toBe(firstShift.id);

  // Kein zweiter Eintrag entstanden (weiterhin genau eine Urlaubsschicht).
  expect(await vacationShiftCount(h.ctx)).toBe(1);
  // vacationDaysUsed NICHT erneut erhöht (weiterhin 1) -> kein Doppelverbrauch.
  expect(await vacationDaysUsed(h.ctx)).toBe(1);
});
