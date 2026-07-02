import { execSync } from "node:child_process";
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { setAccountPlan } from "./helpers/teams";

/**
 * E2E-/API-Test für die strikte, backend-seitige Team-Datentrennung der
 * Dashboard-Endpunkte (`/api/dashboard/summary` + `/api/dashboard/hours-balance`,
 * Multi-Team Stufe 3, #44). Schwester-Test zu dienstplan-team-isolation.spec.ts,
 * das shifts/contracts/time-tracking abdeckt — hier geht es um die aggregierten
 * Kennzahlen/Stunden, deren entferntes Scoping fremde Team-Daten sichtbar machen
 * würde, ohne dass ein anderer Test es bemerkt.
 *
 * Aufbau (rein über die API, identisch zum Isolations-Test):
 * - Dienstleister A = der Setup-Admin, zur Laufzeit auf accountType
 *   "dienstleister" geschaltet. Besitzt zwei frisch angelegte Teams (A und B)
 *   mit je einem Assistenten, einer Schicht und einer Ist-Zeit in einem
 *   dedizierten, weit in der Zukunft liegenden Monat (MONTH/YEAR), damit die
 *   pro Team gescopten Aggregate exakt den frisch angelegten Daten entsprechen
 *   und die Schichten zuverlässig als "anstehend" gelten.
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
 * Alle Testdaten werden in afterAll wieder entfernt; der accountType von A wird
 * auf den Ausgangswert zurückgesetzt.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

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

// Eindeutiger Suffix, damit parallele/wiederholte Läufe nicht kollidieren.
const RUN = Date.now();
const ATTACKER_EMAIL = `e2e.dash.attacker.${RUN}@dienstplan.test`;
const ATTACKER_PASSWORD = "attacker1234";

type LoginResponse = { id: number; accountType: "privat" | "dienstleister" };
type Entity = { id: number };

let adminCtx: APIRequestContext; // Dienstleister A (Datenbesitzer)
let attackerCtx: APIRequestContext; // Admin B (fremder Admin ohne Teams)

let adminId: number;
let originalAccountType: "privat" | "dienstleister";
let attackerId: number;

let teamA: number;
let teamB: number;
let aliceId: number; // Mitglied Team A
let bobId: number; // Mitglied Team B

let shiftA: number;
let shiftB: number;
let timeA: number;
let timeB: number;

async function createUser(data: Record<string, unknown>): Promise<number> {
  const res = await adminCtx.post("/api/users", { data });
  expect(res.ok(), `Nutzer anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

async function createShift(teamId: number, userId: number, day: string): Promise<number> {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId,
      teamId,
      startTime: `${day}T08:00:00.000Z`,
      endTime: `${day}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(res.ok(), `Schicht anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

async function createTimeEntry(teamId: number, userId: number, day: string): Promise<number> {
  const res = await adminCtx.post("/api/time-tracking", {
    data: {
      userId,
      teamId,
      actualStart: `${day}T08:00:00.000Z`,
      actualEnd: `${day}T16:00:00.000Z`,
    },
  });
  expect(res.ok(), `Ist-Zeit anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

test.beforeAll(async () => {
  // --- Dienstleister A einloggen und zum Dienstleister machen ---
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);
  const login = (await loginRes.json()) as LoginResponse;
  adminId = login.id;
  originalAccountType = login.accountType;

  const switchRes = await adminCtx.patch(`/api/users/${adminId}`, {
    data: { accountType: "dienstleister" },
  });
  expect(switchRes.ok(), "Konto-Typ-Wechsel fehlgeschlagen").toBe(true);

  // --- Zwei Teams + Mitglieder + Daten anlegen ---
  const teamARes = await adminCtx.post("/api/teams", { data: { name: `E2E Dash Team A ${RUN}` } });
  expect(teamARes.ok(), "Team A anlegen fehlgeschlagen").toBe(true);
  teamA = ((await teamARes.json()) as Entity).id;

  const teamBRes = await adminCtx.post("/api/teams", { data: { name: `E2E Dash Team B ${RUN}` } });
  expect(teamBRes.ok(), "Team B anlegen fehlgeschlagen").toBe(true);
  teamB = ((await teamBRes.json()) as Entity).id;

  aliceId = await createUser({
    name: `E2E Dash Alice ${RUN}`,
    email: `e2e.dash.alice.${RUN}@dienstplan.test`,
    role: "assistant",
    teamId: teamA,
  });
  bobId = await createUser({
    name: `E2E Dash Bob ${RUN}`,
    email: `e2e.dash.bob.${RUN}@dienstplan.test`,
    role: "assistant",
    teamId: teamB,
  });

  shiftA = await createShift(teamA, aliceId, DAY_SHIFT);
  shiftB = await createShift(teamB, bobId, DAY_SHIFT);
  timeA = await createTimeEntry(teamA, aliceId, DAY_TIME);
  timeB = await createTimeEntry(teamB, bobId, DAY_TIME);

  // --- Admin B (fremder Admin ohne Teams) seeden ---
  // WICHTIG: Gegen die isolierte Test-DB seeden (E2E_TEST_DATABASE_URL aus der
  // playwright.config), sonst landet der Angreifer in der Dev-DB und der
  // Login gegen den Test-Stack schlägt fehl (gleiches Muster wie
  // harness.seedForeignAdmin in helpers/teams.ts).
  const seedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ADMIN_EMAIL: ATTACKER_EMAIL,
    ADMIN_PASSWORD: ATTACKER_PASSWORD,
    ADMIN_NAME: `E2E Dash Attacker ${RUN}`,
  };
  if (process.env.E2E_TEST_DATABASE_URL) {
    seedEnv.DATABASE_URL = process.env.E2E_TEST_DATABASE_URL;
  }
  execSync("pnpm --filter @workspace/scripts run setup-admin", {
    env: seedEnv,
    stdio: "pipe",
  });

  // hours-balance ist Premium-gegated (advancedAnalytics); der Angreifer muss
  // Premium sein, damit die Leerer-Scope-Tests 200 statt 403 (plan-Gate)
  // prüfen — sonst testet der 403 nicht die Datentrennung.
  setAccountPlan(ATTACKER_EMAIL, "premium");

  attackerCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const attackerLogin = await attackerCtx.post("/api/auth/login", {
    data: { email: ATTACKER_EMAIL, password: ATTACKER_PASSWORD },
  });
  expect(attackerLogin.ok(), "Angreifer-Login fehlgeschlagen").toBe(true);
  const me = await attackerCtx.get("/api/auth/me");
  attackerId = ((await me.json()) as Entity).id;
});

test.afterAll(async () => {
  const tryDelete = async (path: string) => {
    try {
      await adminCtx.delete(path);
    } catch {
      /* ignore */
    }
  };

  for (const id of [timeA, timeB]) if (id) await tryDelete(`/api/time-tracking/${id}`);
  for (const id of [shiftA, shiftB]) if (id) await tryDelete(`/api/shifts/${id}`);

  // Admin B kann nur gelöscht werden, wenn er in einem erlaubten Team liegt
  // (IDOR-Schutz auf DELETE /users). Kurz Team A zuweisen, dann löschen.
  if (attackerId && teamA) {
    try {
      await adminCtx.post(`/api/teams/${teamA}/members`, { data: { userId: attackerId } });
    } catch {
      /* ignore */
    }
    await tryDelete(`/api/users/${attackerId}`);
  }
  for (const id of [aliceId, bobId]) if (id) await tryDelete(`/api/users/${id}`);
  for (const id of [teamA, teamB]) if (id) await tryDelete(`/api/teams/${id}`);

  if (adminId && originalAccountType) {
    try {
      await adminCtx.patch(`/api/users/${adminId}`, {
        data: { accountType: originalAccountType },
      });
    } catch {
      /* ignore */
    }
  }

  await adminCtx.dispose();
  await attackerCtx?.dispose();
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
