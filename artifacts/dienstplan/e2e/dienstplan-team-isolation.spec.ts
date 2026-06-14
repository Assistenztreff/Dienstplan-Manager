import { execSync } from "node:child_process";
import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-/API-Test für die strikte, backend-seitige Team-Datentrennung
 * (Multi-Team Stufe 3, #44). Regressionsschutz: ein versehentlich entferntes
 * Scoping würde Daten zwischen Teams leaken.
 *
 * Aufbau (rein über die API):
 * - Dienstleister A = der Setup-Admin, zur Laufzeit auf accountType
 *   "dienstleister" geschaltet. Besitzt zwei frisch angelegte Teams (A und B)
 *   mit je einem Assistenten und je einer Schicht / einem Vertrag / einer
 *   Ist-Zeit. Damit lassen sich disjunkte Datenmengen pro Team prüfen.
 * - Admin B = ein zweiter, über das setup-admin-Skript geseedeter Admin OHNE
 *   Teams (reiner "Angreifer"). Da accountType + Rolle eines Nutzers NICHT über
 *   die öffentliche API gesetzt werden können, ist ein zweiter echter Admin nur
 *   per Seed möglich. Er besitzt/ist Mitglied in keinem Team -> jede Zeile der
 *   Teams von A ist für ihn "fremd" und muss 404 (by-id) bzw. 403 (Listen mit
 *   fremdem teamId) liefern.
 *
 * Geprüft (Done-Kriterien der Aufgabe):
 * - Fremdes teamId an den Listen-Endpunkten (shifts/contracts/time-tracking)
 *   -> 403.
 * - GET /shifts/:id, /contracts/:id, /time-tracking/:id mit fremdem Team
 *   -> 404 (IDOR-Schutz).
 * - Die Scopes der beiden Teams liefern disjunkte Datenmengen; die ungescopte
 *   Liste enthält beide.
 *
 * Alle angelegten Testdaten (Teams, Nutzer, Schichten, Verträge, Ist-Zeiten,
 * der geseedete Admin B) werden in afterAll wieder entfernt; der accountType
 * von A wird auf den Ausgangswert zurückgesetzt.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const NONEXISTENT_TEAM_ID = 999999;

// Eindeutiger Suffix, damit parallele/wiederholte Läufe nicht kollidieren.
const RUN = Date.now();
const ATTACKER_EMAIL = `e2e.attacker.${RUN}@dienstplan.test`;
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
let contractA: number;
let contractB: number;
let timeA: number;
let timeB: number;

async function createUser(
  ctx: APIRequestContext,
  data: Record<string, unknown>,
): Promise<number> {
  const res = await ctx.post("/api/users", { data });
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

async function createContract(teamId: number, userId: number): Promise<number> {
  const res = await adminCtx.post("/api/contracts", {
    data: {
      userId,
      teamId,
      weeklyHours: 40,
      vacationDays: 30,
      startDate: "2026-01-01",
    },
  });
  expect(res.ok(), `Vertrag anlegen fehlgeschlagen (${res.status()})`).toBe(true);
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
  const teamARes = await adminCtx.post("/api/teams", { data: { name: `E2E Team A ${RUN}` } });
  expect(teamARes.ok(), "Team A anlegen fehlgeschlagen").toBe(true);
  teamA = ((await teamARes.json()) as Entity).id;

  const teamBRes = await adminCtx.post("/api/teams", { data: { name: `E2E Team B ${RUN}` } });
  expect(teamBRes.ok(), "Team B anlegen fehlgeschlagen").toBe(true);
  teamB = ((await teamBRes.json()) as Entity).id;

  aliceId = await createUser(adminCtx, {
    name: `E2E Alice ${RUN}`,
    email: `e2e.alice.${RUN}@dienstplan.test`,
    role: "assistant",
    teamId: teamA,
  });
  bobId = await createUser(adminCtx, {
    name: `E2E Bob ${RUN}`,
    email: `e2e.bob.${RUN}@dienstplan.test`,
    role: "assistant",
    teamId: teamB,
  });

  shiftA = await createShift(teamA, aliceId, "2026-07-01");
  shiftB = await createShift(teamB, bobId, "2026-07-02");
  contractA = await createContract(teamA, aliceId);
  contractB = await createContract(teamB, bobId);
  timeA = await createTimeEntry(teamA, aliceId, "2026-07-03");
  timeB = await createTimeEntry(teamB, bobId, "2026-07-04");

  // --- Admin B (fremder Admin ohne Teams) seeden ---
  // accountType + Rolle lassen sich nicht über die API setzen; ein zweiter
  // echter Admin ist nur per setup-admin-Skript möglich (idempotent; legt KEIN
  // Team an, da bereits Teams existieren).
  execSync("pnpm --filter @workspace/scripts run setup-admin", {
    env: {
      ...process.env,
      ADMIN_EMAIL: ATTACKER_EMAIL,
      ADMIN_PASSWORD: ATTACKER_PASSWORD,
      ADMIN_NAME: `E2E Attacker ${RUN}`,
    },
    stdio: "pipe",
  });

  attackerCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const attackerLogin = await attackerCtx.post("/api/auth/login", {
    data: { email: ATTACKER_EMAIL, password: ATTACKER_PASSWORD },
  });
  expect(attackerLogin.ok(), "Angreifer-Login fehlgeschlagen").toBe(true);
  const me = await attackerCtx.get("/api/auth/me");
  attackerId = ((await me.json()) as Entity).id;
});

test.afterAll(async () => {
  // Best-effort-Cleanup in FK-sicherer Reihenfolge: erst Daten, dann Nutzer,
  // dann Teams. Fehlschläge einzelner Schritte sollen die übrigen nicht blocken.
  const tryDelete = async (path: string) => {
    try {
      await adminCtx.delete(path);
    } catch {
      /* ignore */
    }
  };

  for (const id of [timeA, timeB]) if (id) await tryDelete(`/api/time-tracking/${id}`);
  for (const id of [contractA, contractB]) if (id) await tryDelete(`/api/contracts/${id}`);
  for (const id of [shiftA, shiftB]) if (id) await tryDelete(`/api/shifts/${id}`);

  // Admin B kann nur gelöscht werden, wenn er in einem erlaubten Team liegt
  // (IDOR-Schutz auf DELETE /users). Kurz Team A zuweisen, dann löschen
  // (cascade entfernt die Mitgliedschaft wieder).
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

  // Konto-Typ von A zurücksetzen.
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

test.describe("Team-Datentrennung: disjunkte Scopes (als Dienstleister A)", () => {
  type Row = { id: number };

  const listIds = async (path: string): Promise<Set<number>> => {
    const res = await adminCtx.get(path);
    expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
    return new Set(((await res.json()) as Row[]).map((r) => r.id));
  };

  test("Schichten: Team A und Team B sind disjunkt, ungescopt enthält beide", async () => {
    const a = await listIds(`/api/shifts?teamId=${teamA}`);
    const b = await listIds(`/api/shifts?teamId=${teamB}`);
    const all = await listIds(`/api/shifts`);

    expect(a.has(shiftA)).toBe(true);
    expect(a.has(shiftB)).toBe(false);
    expect(b.has(shiftB)).toBe(true);
    expect(b.has(shiftA)).toBe(false);
    expect(all.has(shiftA) && all.has(shiftB)).toBe(true);
  });

  test("Verträge: Team A und Team B sind disjunkt, ungescopt enthält beide", async () => {
    const a = await listIds(`/api/contracts?teamId=${teamA}`);
    const b = await listIds(`/api/contracts?teamId=${teamB}`);
    const all = await listIds(`/api/contracts`);

    expect(a.has(contractA)).toBe(true);
    expect(a.has(contractB)).toBe(false);
    expect(b.has(contractB)).toBe(true);
    expect(b.has(contractA)).toBe(false);
    expect(all.has(contractA) && all.has(contractB)).toBe(true);
  });

  test("Ist-Zeiten: Team A und Team B sind disjunkt, ungescopt enthält beide", async () => {
    const a = await listIds(`/api/time-tracking?teamId=${teamA}`);
    const b = await listIds(`/api/time-tracking?teamId=${teamB}`);
    const all = await listIds(`/api/time-tracking`);

    expect(a.has(timeA)).toBe(true);
    expect(a.has(timeB)).toBe(false);
    expect(b.has(timeB)).toBe(true);
    expect(b.has(timeA)).toBe(false);
    expect(all.has(timeA) && all.has(timeB)).toBe(true);
  });
});

test.describe("Team-Datentrennung: fremdes teamId an Listen -> 403", () => {
  test("Dienstleister A: nicht existierendes teamId -> 403 (alle Listen)", async () => {
    for (const path of ["shifts", "contracts", "time-tracking"]) {
      const res = await adminCtx.get(`/api/${path}?teamId=${NONEXISTENT_TEAM_ID}`);
      expect(res.status(), `${path}`).toBe(403);
    }
  });

  test("Fremder Admin B: teamId eines fremden Teams -> 403 (alle Listen)", async () => {
    for (const path of ["shifts", "contracts", "time-tracking"]) {
      const res = await attackerCtx.get(`/api/${path}?teamId=${teamA}`);
      expect(res.status(), `${path}`).toBe(403);
    }
  });

  test("Fremder Admin B ohne teamId sieht keine Daten (leerer Scope)", async () => {
    for (const path of ["shifts", "contracts", "time-tracking"]) {
      const res = await attackerCtx.get(`/api/${path}`);
      expect(res.ok(), `${path} -> ${res.status()}`).toBe(true);
      expect((await res.json()) as unknown[], `${path}`).toEqual([]);
    }
  });
});

test.describe("Team-Datentrennung: IDOR by-id mit fremdem Team -> 404", () => {
  test("GET /shifts/:id eines fremden Teams -> 404", async () => {
    const res = await attackerCtx.get(`/api/shifts/${shiftA}`);
    expect(res.status()).toBe(404);
  });

  test("GET /contracts/:id eines fremden Teams -> 404", async () => {
    const res = await attackerCtx.get(`/api/contracts/${contractA}`);
    expect(res.status()).toBe(404);
  });

  test("GET /time-tracking/:id eines fremden Teams -> 404", async () => {
    const res = await attackerCtx.get(`/api/time-tracking/${timeA}`);
    expect(res.status()).toBe(404);
  });

  test("Sanity: derselbe Datensatz ist für den Besitzer (A) abrufbar", async () => {
    expect((await adminCtx.get(`/api/shifts/${shiftA}`)).status()).toBe(200);
    expect((await adminCtx.get(`/api/contracts/${contractA}`)).status()).toBe(200);
    expect((await adminCtx.get(`/api/time-tracking/${timeA}`)).status()).toBe(200);
  });
});
