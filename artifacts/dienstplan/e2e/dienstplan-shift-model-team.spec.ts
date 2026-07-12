import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * E2E-/API-Test für die team-bezogene Validierung des Schichtmodells einer
 * Schicht (Multi-Team, #47). Sicherheitsrelevant: eine Schicht darf nur mit
 * einem Schichtmodell aus dem eigenen Team verknüpft werden, sonst flössen die
 * Wertungs-/Zuschlagsparameter eines fremden Teams in die Auswertung ein.
 *
 * Diese Regel war bisher nur manuell per curl geprüft; dieser Test schützt sie
 * gegen unbemerkte Regressionen.
 *
 * Aufbau (rein über die API): Ein über den TeamTestHarness FRISCH registriertes
 * Dienstleister-Konto (accountType ist seit dem Lockdown NICHT mehr per API
 * änderbar; Premium via set-plan) legt zwei Teams (A und B) mit je einem
 * Schichtmodell sowie einem Mitglied an. Damit lassen sich eigenes vs. fremdes
 * Modell gegeneinander prüfen.
 *
 * Geprüft (Done-Kriterien der Aufgabe):
 * - POST /api/shifts mit shiftModelId eines fremden Teams -> 403.
 * - POST /api/shifts mit eigenem Modell -> 201.
 * - PATCH /api/shifts/:id auf ein Fremdmodell -> 403; auf ein eigenes -> 200.
 *
 * Alle angelegten Testdaten werden in afterAll wieder entfernt (Schicht +
 * Modelle explizit, der Rest über harness.cleanup()).
 */

type Entity = { id: number };

let h: TeamTestHarness;

let teamA: number;
let teamB: number;
let modelA: number; // Schichtmodell in Team A (eigenes Modell)
let modelB: number; // Schichtmodell in Team B (fremdes Modell)
let aliceId: number; // Mitglied von Team A
let ownShiftId: number; // mit eigenem Modell angelegte Schicht (für PATCH-Tests)

async function createShiftModel(teamId: number, name: string): Promise<number> {
  const res = await h.ctx.post("/api/shift-models", {
    data: {
      name,
      valuationPercent: 100,
      color: "#3366cc",
      sortOrder: 999,
      isActive: true,
      teamId,
    },
  });
  expect(res.ok(), `Schichtmodell anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

test.beforeAll(async () => {
  // Registrierung + set-plan-Skript können die Standard-Hook-Zeit sprengen
  // (Cold-Start des Test-Stacks).
  test.setTimeout(120_000);

  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  teamA = await h.createTeam(`E2E SM Team A ${h.run}`);
  teamB = await h.createTeam(`E2E SM Team B ${h.run}`);
  modelA = await createShiftModel(teamA, `E2E Modell A ${h.run}`);
  modelB = await createShiftModel(teamB, `E2E Modell B ${h.run}`);
  aliceId = await h.createUser({
    name: `E2E Alice ${h.run}`,
    email: `e2e.alice.${h.run}@dienstplan.test`,
    role: "assistant",
    teamId: teamA,
  });
});

test.afterAll(async () => {
  // FK-sichere Reihenfolge: Schicht -> Modelle (beides nicht vom Harness
  // getrackt), dann der restliche Datenbaum über harness.cleanup().
  const tryDelete = async (path: string) => {
    try {
      await h.ctx.delete(path);
    } catch {
      /* ignore */
    }
  };
  if (ownShiftId) await tryDelete(`/api/shifts/${ownShiftId}`);
  for (const id of [modelA, modelB]) if (id) await tryDelete(`/api/shift-models/${id}`);
  await h?.cleanup();
});

test.describe("Schicht akzeptiert nur Schichtmodelle des eigenen Teams", () => {
  test("POST /shifts mit Fremdmodell (Team B) für eine Schicht in Team A -> 403", async () => {
    const res = await h.ctx.post("/api/shifts", {
      data: {
        userId: aliceId,
        teamId: teamA,
        startTime: "2026-08-01T08:00:00.000Z",
        endTime: "2026-08-01T16:00:00.000Z",
        type: "active",
        shiftModelId: modelB,
      },
    });
    expect(res.status()).toBe(403);
  });

  test("POST /shifts mit eigenem Modell (Team A) -> 201", async () => {
    const res = await h.ctx.post("/api/shifts", {
      data: {
        userId: aliceId,
        teamId: teamA,
        startTime: "2026-08-02T08:00:00.000Z",
        endTime: "2026-08-02T16:00:00.000Z",
        type: "active",
        shiftModelId: modelA,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    ownShiftId = ((await res.json()) as Entity).id;
  });

  test("PATCH /shifts/:id auf ein Fremdmodell (Team B) -> 403", async () => {
    expect(ownShiftId, "Voraussetzung: eigene Schicht wurde angelegt").toBeTruthy();
    const res = await h.ctx.patch(`/api/shifts/${ownShiftId}`, {
      data: { shiftModelId: modelB },
    });
    expect(res.status()).toBe(403);
  });

  test("PATCH /shifts/:id auf ein eigenes Modell (Team A) -> 200", async () => {
    expect(ownShiftId, "Voraussetzung: eigene Schicht wurde angelegt").toBeTruthy();
    const res = await h.ctx.patch(`/api/shifts/${ownShiftId}`, {
      data: { shiftModelId: modelA },
    });
    expect(res.status(), await res.text()).toBe(200);
  });
});
