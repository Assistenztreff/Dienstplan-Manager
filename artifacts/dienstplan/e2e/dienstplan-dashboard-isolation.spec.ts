import { test, expect, type APIRequestContext } from "@playwright/test";
import { TeamTestHarness, setAccountPlan } from "./helpers/teams";

/**
 * E2E-/API-Test für die strikte, backend-seitige Team-Datentrennung der
 * Dashboard-Endpunkte (`/api/dashboard/summary` + `/api/dashboard/hours-balance`,
 * Multi-Team Stufe 3, #44). Schwester-Test zu dienstplan-team-isolation.spec.ts,
 * das shifts/contracts/time-tracking abdeckt — hier geht es um die aggregierten
 * Kennzahlen/Stunden, deren entferntes Scoping fremde Team-Daten sichtbar machen
 * würde, ohne dass ein anderer Test es bemerkt.
 *
 * Aufbau (rein über die API, identisch zum Isolations-Test):
 * - Dienstleister A = ein über den TeamTestHarness FRISCH registriertes
 *   Dienstleister-Konto (accountType ist seit dem Lockdown NICHT mehr per API
 *   änderbar), per set-plan auf Premium gehoben. Besitzt zwei frisch angelegte
 *   Teams (A und B) mit je einem Assistenten, einer Schicht und einer Ist-Zeit
 *   in einem dedizierten zukünftigen Monat (MONTH/YEAR), damit die pro Team
 *   gescopten Aggregate exakt den frisch angelegten Daten entsprechen und die
 *   Schichten zuverlässig als "anstehend" gelten.
 * - Admin B = ein zweiter, per setup-admin-Skript geseedeter Admin OHNE Teams
 *   (reiner "Angreifer"). accountType + Rolle lassen sich nicht über die
 *   öffentliche API setzen, daher nur per Seed möglich.
 *
 * Geprüft (Done-Kriterien der Aufgabe):
 * - Fremdes/unbekanntes teamId an summary + hours-balance -> 403.
 * - Mit erlaubtem teamId nur die Daten dieses Teams (exakte Aggregate; die
 *   eingebetteten upcomingShifts/recentTimeEntries bzw. hours-balance-Zeilen
 *   sind pro Team disjunkt).
 * - Die ungescopte Antwort enthält beide Teams (Vereinigung), die scopten
 *   Antworten von Team A und Team B sind disjunkt.
 *
 * Alle Testdaten werden in afterAll über harness.cleanup() wieder entfernt
 * (inkl. des registrierten Dienstleister-Kontos samt Datenbaum).
 */

const NONEXISTENT_TEAM_ID = 999999;

// Dedizierter Monat weit in der Zukunft: macht die pro Team gescopten Aggregate
// deterministisch (keine Kollision mit Bestandsdaten) und sorgt dafür, dass die
// Schichten als "anstehend" (startTime >= heute) in upcomingShifts erscheinen.
// Dynamischer Zielmonat = nächster Monat: liegt für jeden Plan (auch Free,
// historyMonths=1) im erlaubten Vorausplanungs-Fenster und ist sicher zukünftig
// (upcomingShifts). Kollisionsschutz braucht es nicht: alle Aggregate sind auf
// frisch angelegte Teams/Nutzer gescoped.
const TARGET = new Date();
TARGET.setDate(1);
TARGET.setMonth(TARGET.getMonth() + 1);
const YEAR = TARGET.getFullYear();
const MONTH = TARGET.getMonth() + 1;
const MM = String(MONTH).padStart(2, "0");
const DAY_SHIFT = `${YEAR}-${MM}-10`;
const DAY_TIME = `${YEAR}-${MM}-11`;
const SHIFT_HOURS = 8;

let h: TeamTestHarness;
let adminCtx: APIRequestContext; // Dienstleister A (Datenbesitzer)
let attackerCtx: APIRequestContext; // Admin B (fremder Admin ohne Teams)

let teamA: number;
let teamB: number;
let aliceId: number; // Mitglied Team A
let bobId: number; // Mitglied Team B

let shiftA: number;
let shiftB: number;
let timeA: number;
let timeB: number;

test.beforeAll(async () => {
  // Registrierung + Datenaufbau + zwei execSync-Skripte (set-plan, setup-admin)
  // können zusammen die Standard-Hook-Zeit sprengen (Cold-Start des Test-Stacks).
  test.setTimeout(120_000);

  // --- Dienstleister A: frisch registriertes Dienstleister-Konto (Premium) ---
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();
  adminCtx = h.ctx;

  // --- Zwei Teams + Mitglieder + Daten anlegen ---
  teamA = await h.createTeam(`E2E Dash Team A ${h.run}`);
  teamB = await h.createTeam(`E2E Dash Team B ${h.run}`);

  aliceId = await h.createUser({
    name: `E2E Dash Alice ${h.run}`,
    email: `e2e.dash.alice.${h.run}@dienstplan.test`,
    role: "assistant",
    teamId: teamA,
  });
  bobId = await h.createUser({
    name: `E2E Dash Bob ${h.run}`,
    email: `e2e.dash.bob.${h.run}@dienstplan.test`,
    role: "assistant",
    teamId: teamB,
  });

  shiftA = await h.createShift(teamA, aliceId, DAY_SHIFT);
  shiftB = await h.createShift(teamB, bobId, DAY_SHIFT);
  timeA = await h.createTimeEntry(teamA, aliceId, DAY_TIME);
  timeB = await h.createTimeEntry(teamB, bobId, DAY_TIME);

  // --- Admin B (fremder Admin ohne Teams) seeden ---
  const attacker = await h.seedForeignAdmin({
    email: `e2e.dash.attacker.${h.run}@dienstplan.test`,
    name: `E2E Dash Attacker ${h.run}`,
  });
  // hours-balance ist Premium-gegated (advancedAnalytics); der Angreifer muss
  // Premium sein, damit die Leerer-Scope-Tests 200 statt 403 (plan-Gate)
  // prüfen — sonst testet der 403 nicht die Datentrennung.
  setAccountPlan(attacker.email, "premium");
  attackerCtx = attacker.ctx;
});

test.afterAll(async () => {
  await h?.cleanup();
});

type SummaryResponse = {
  totalAssistants: number;
  monthlyPlannedHours: number;
  pendingTimeEntries: number;
  upcomingShifts: { id: number }[];
  recentTimeEntries: { id: number }[];
};

type HoursBalanceRow = { userId: number; plannedHours: number };

const summary = async (
  ctx: APIRequestContext,
  query: string,
): Promise<{ status: number; body: SummaryResponse }> => {
  const res = await ctx.get(`/api/dashboard/summary?month=${MONTH}&year=${YEAR}${query}`);
  return { status: res.status(), body: res.ok() ? ((await res.json()) as SummaryResponse) : ({} as SummaryResponse) };
};

const hoursBalance = async (
  ctx: APIRequestContext,
  query: string,
): Promise<{ status: number; body: HoursBalanceRow[] }> => {
  const res = await ctx.get(`/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}${query}`);
  return { status: res.status(), body: res.ok() ? ((await res.json()) as HoursBalanceRow[]) : [] };
};

test.describe("Dashboard summary: Team-Datentrennung", () => {
  test("teamId=Team A liefert nur Team-A-Daten (exakte Aggregate)", async () => {
    const { status, body } = await summary(adminCtx, `&teamId=${teamA}`);
    expect(status).toBe(200);
    expect(body.totalAssistants).toBe(1);
    expect(body.monthlyPlannedHours).toBe(SHIFT_HOURS);
    expect(body.pendingTimeEntries).toBe(1);
    const shiftIds = body.upcomingShifts.map((s) => s.id);
    const timeIds = body.recentTimeEntries.map((t) => t.id);
    expect(shiftIds).toContain(shiftA);
    expect(shiftIds).not.toContain(shiftB);
    expect(timeIds).toContain(timeA);
    expect(timeIds).not.toContain(timeB);
  });

  test("teamId=Team B liefert nur Team-B-Daten (disjunkt zu Team A)", async () => {
    const { status, body } = await summary(adminCtx, `&teamId=${teamB}`);
    expect(status).toBe(200);
    expect(body.totalAssistants).toBe(1);
    expect(body.monthlyPlannedHours).toBe(SHIFT_HOURS);
    expect(body.pendingTimeEntries).toBe(1);
    const shiftIds = body.upcomingShifts.map((s) => s.id);
    const timeIds = body.recentTimeEntries.map((t) => t.id);
    expect(shiftIds).toContain(shiftB);
    expect(shiftIds).not.toContain(shiftA);
    expect(timeIds).toContain(timeB);
    expect(timeIds).not.toContain(timeA);
  });

  test("ungescopt enthält beide Teams (Vereinigung)", async () => {
    const { status, body } = await summary(adminCtx, "");
    expect(status).toBe(200);
    const shiftIds = body.upcomingShifts.map((s) => s.id);
    // upcomingShifts ist auf 5 limitiert; planned-hours-Aggregat ist robuster.
    expect(body.monthlyPlannedHours).toBe(SHIFT_HOURS * 2);
    expect(body.totalAssistants).toBeGreaterThanOrEqual(2);
    expect(body.pendingTimeEntries).toBeGreaterThanOrEqual(2);
    // upcomingShifts ist auf die 5 zeitlich nächsten Schichten limitiert —
    // andere Specs derselben Suite können mit näher liegenden Schichten die
    // Liste füllen und unsere Test-Schichten verdrängen. Nur wenn die Liste
    // NICHT voll ist, müssen unsere Schichten enthalten sein; die Aggregate
    // (monthlyPlannedHours oben) beweisen die Vereinigung bereits robust.
    if (body.upcomingShifts.length < 5) {
      expect(shiftIds.some((id) => id === shiftA || id === shiftB)).toBe(true);
    }
  });

  test("unbekanntes teamId -> 403", async () => {
    const { status } = await summary(adminCtx, `&teamId=${NONEXISTENT_TEAM_ID}`);
    expect(status).toBe(403);
  });

  test("fremder Admin mit fremdem teamId -> 403", async () => {
    const { status } = await summary(attackerCtx, `&teamId=${teamA}`);
    expect(status).toBe(403);
  });

  test("fremder Admin ohne teamId sieht keine Team-Daten (leerer Scope)", async () => {
    const { status, body } = await summary(attackerCtx, "");
    expect(status).toBe(200);
    expect(body.totalAssistants).toBe(0);
    expect(body.monthlyPlannedHours).toBe(0);
    expect(body.upcomingShifts).toEqual([]);
  });
});

test.describe("Dashboard hours-balance: Team-Datentrennung", () => {
  test("teamId=Team A enthält nur Team-A-Assistenten", async () => {
    const { status, body } = await hoursBalance(adminCtx, `&teamId=${teamA}`);
    expect(status).toBe(200);
    const userIds = body.map((r) => r.userId);
    expect(userIds).toContain(aliceId);
    expect(userIds).not.toContain(bobId);
    const alice = body.find((r) => r.userId === aliceId);
    expect(alice?.plannedHours).toBe(SHIFT_HOURS);
  });

  test("teamId=Team B enthält nur Team-B-Assistenten (disjunkt zu A)", async () => {
    const { status, body } = await hoursBalance(adminCtx, `&teamId=${teamB}`);
    expect(status).toBe(200);
    const userIds = body.map((r) => r.userId);
    expect(userIds).toContain(bobId);
    expect(userIds).not.toContain(aliceId);
    const bob = body.find((r) => r.userId === bobId);
    expect(bob?.plannedHours).toBe(SHIFT_HOURS);
  });

  test("ungescopt enthält Assistenten beider Teams (Vereinigung)", async () => {
    const { status, body } = await hoursBalance(adminCtx, "");
    expect(status).toBe(200);
    const userIds = body.map((r) => r.userId);
    expect(userIds).toContain(aliceId);
    expect(userIds).toContain(bobId);
  });

  test("unbekanntes teamId -> 403", async () => {
    const { status } = await hoursBalance(adminCtx, `&teamId=${NONEXISTENT_TEAM_ID}`);
    expect(status).toBe(403);
  });

  test("fremder Admin mit fremdem teamId -> 403", async () => {
    const { status } = await hoursBalance(attackerCtx, `&teamId=${teamA}`);
    expect(status).toBe(403);
  });

  test("fremder Admin ohne teamId sieht keine Assistenten (leerer Scope)", async () => {
    const { status, body } = await hoursBalance(attackerCtx, "");
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});
