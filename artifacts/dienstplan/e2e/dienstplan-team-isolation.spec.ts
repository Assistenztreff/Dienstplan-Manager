import { test, expect, type APIRequestContext } from "@playwright/test";
import { TeamTestHarness, type SeededAdmin } from "./helpers/teams";

/**
 * E2E-/API-Test für die strikte, backend-seitige Team-Datentrennung
 * (Multi-Team Stufe 3, #44). Regressionsschutz: ein versehentlich entferntes
 * Scoping würde Daten zwischen Teams leaken.
 *
 * Das Setup (Dienstleister-Login, accountType-Wechsel, Team-/Nutzer-/Daten-
 * Erstellung, FK-sicheres Cleanup, Seeden eines zweiten "fremden" Admins) ist
 * in `helpers/teams.ts` gekapselt (#52) und wird hier wiederverwendet.
 *
 * Aufbau (rein über die API):
 * - Dienstleister A = der Setup-Admin, zur Laufzeit auf accountType
 *   "dienstleister" geschaltet. Besitzt zwei frisch angelegte Teams (A und B)
 *   mit je einem Assistenten und je einer Schicht / einem Vertrag / einer
 *   Ist-Zeit. Damit lassen sich disjunkte Datenmengen pro Team prüfen.
 * - Admin B = ein zweiter, über das setup-admin-Skript geseedeter Admin OHNE
 *   Teams (reiner "Angreifer"). Er besitzt/ist Mitglied in keinem Team -> jede
 *   Zeile der Teams von A ist für ihn "fremd" und muss 404 (by-id) bzw. 403
 *   (Listen mit fremdem teamId) liefern.
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

const NONEXISTENT_TEAM_ID = 999999;

let harness: TeamTestHarness;
let adminCtx: APIRequestContext; // Dienstleister A (Datenbesitzer)
let attacker: SeededAdmin; // Admin B (fremder Admin ohne Teams)
let attackerCtx: APIRequestContext;

let teamA: number;
let teamB: number;

let shiftA: number;
let shiftB: number;
let contractA: number;
let contractB: number;
let timeA: number;
let timeB: number;

test.beforeAll(async () => {
  // --- Dienstleister A einloggen und zum Dienstleister machen ---
  harness = await TeamTestHarness.login();
  await harness.becomeDienstleister();
  adminCtx = harness.ctx;

  // --- Zwei Teams + Mitglieder + Daten anlegen ---
  teamA = await harness.createTeam(`E2E Team A ${harness.run}`);
  teamB = await harness.createTeam(`E2E Team B ${harness.run}`);

  const aliceId = await harness.createUser({
    name: `E2E Alice ${harness.run}`,
    email: `e2e.alice.${harness.run}@dienstplan.test`,
    role: "assistant",
    teamId: teamA,
  });
  const bobId = await harness.createUser({
    name: `E2E Bob ${harness.run}`,
    email: `e2e.bob.${harness.run}@dienstplan.test`,
    role: "assistant",
    teamId: teamB,
  });

  shiftA = await harness.createShift(teamA, aliceId, "2026-07-01");
  shiftB = await harness.createShift(teamB, bobId, "2026-07-02");
  contractA = await harness.createContract(teamA, aliceId);
  contractB = await harness.createContract(teamB, bobId);
  timeA = await harness.createTimeEntry(teamA, aliceId, "2026-07-03");
  timeB = await harness.createTimeEntry(teamB, bobId, "2026-07-04");

  // --- Admin B (fremder Admin ohne Teams) seeden ---
  attacker = await harness.seedForeignAdmin();
  attackerCtx = attacker.ctx;
});

test.afterAll(async () => {
  await harness.cleanup();
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
