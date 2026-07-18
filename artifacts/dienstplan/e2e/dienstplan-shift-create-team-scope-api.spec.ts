import { test, expect } from "@playwright/test";
import { TeamTestHarness, type SeededAdmin } from "./helpers/teams";

/**
 * API-Test (#443, Teil 3): SCHREIB-Seite der Schicht-Anlage —
 * `POST /api/shifts` gegen die Team-Scoping- und Member-of-Team-Invariante.
 *
 * Die by-id-Schreiboperationen (PATCH/DELETE) sind bereits abgesichert
 * (dienstplan-shifts-write-idor-api.spec.ts). Hier geht es um das ANLEGEN:
 * - Eine fremde `teamId` (Team eines anderen Kontos) muss 403 liefern
 *   (resolveWriteTeamId erkennt fehlenden Zugriff) — sonst liesse sich eine
 *   Schicht in ein fremdes Team einschleusen.
 * - Ein `body.userId`, der NICHT Mitglied des Ziel-Teams ist, muss 403 liefern
 *   (Member-of-Team-Invariante) — sonst liesse sich ein teamfremder Nutzer in
 *   ein erlaubtes Team verknuepfen und dessen PII ueber gescopte Listen
 *   auslesen (die GET-Antwort joint den Nutzer).
 *
 * Aufbau (Muster: dienstplan-shift-model-team-idor.spec.ts):
 * - Dienstleister A (frisch registriert, Premium) besitzt zwei Teams A und B
 *   mit je einem Assistenten (aliceA in Team A, bobB in Team B).
 * - Admin B = ein geseedeter Fremd-Admin OHNE Teams (reiner Angreifer). Fuer ihn
 *   ist Team A fremd -> POST mit dessen teamId muss 403 liefern.
 *
 * Geprueft (Done-Kriterien):
 * 1. Admin B -> POST /shifts mit fremder teamId (Team A): 403.
 * 2. Dienstleister A -> POST /shifts mit teamId=Team A, aber userId=bobB
 *    (Mitglied von Team B, NICHT von Team A): 403 (Member-of-Team-Invariante).
 * 3. Kontrollfall: Dienstleister A -> POST /shifts mit teamId=Team A und
 *    userId=aliceA (gueltiges Team + Mitglied): 201.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

// Aktueller Monat (Premium => keine historyMonths-Grenze, dennoch robust).
const now = new Date();
const DAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
const START = `${DAY}T08:00:00.000Z`;
const END = `${DAY}T16:00:00.000Z`;

let harness: TeamTestHarness;
let attacker: SeededAdmin;

let teamA = 0;
let teamB = 0;
let aliceA = 0;
let bobB = 0;

test.beforeAll(async () => {
  test.setTimeout(120_000);

  harness = await TeamTestHarness.login();
  await harness.becomeDienstleister();

  teamA = await harness.createTeam(`E2E ShiftCreate Team A ${harness.run}`);
  teamB = await harness.createTeam(`E2E ShiftCreate Team B ${harness.run}`);
  aliceA = await harness.createUser({ teamId: teamA, role: "assistant" });
  bobB = await harness.createUser({ teamId: teamB, role: "assistant" });

  attacker = await harness.seedForeignAdmin();
});

test.afterAll(async () => {
  await harness.cleanup();
});

test("Admin B bekommt 403 beim POST /shifts mit fremder teamId", async () => {
  const res = await attacker.ctx.post("/api/shifts", {
    data: { userId: aliceA, teamId: teamA, startTime: START, endTime: END, type: "active" },
  });
  expect(
    res.status(),
    "SICHERHEIT: POST /shifts mit fremder teamId muss 403 liefern (kein Team-Zugriff)",
  ).toBe(403);
});

test("Dienstleister A bekommt 403 beim POST /shifts mit teamfremdem userId", async () => {
  const res = await harness.ctx.post("/api/shifts", {
    data: { userId: bobB, teamId: teamA, startTime: START, endTime: END, type: "active" },
  });
  expect(
    res.status(),
    "SICHERHEIT: userId muss Mitglied des Ziel-Teams sein (Member-of-Team-Invariante) -> 403",
  ).toBe(403);
});

test("Kontrollfall: gueltiges Team + Mitglied -> 201", async () => {
  const res = await harness.ctx.post("/api/shifts", {
    data: { userId: aliceA, teamId: teamA, startTime: START, endTime: END, type: "active" },
  });
  expect(res.status(), "Gueltige Schicht-Anlage muss 201 liefern").toBe(201);
  const body = (await res.json()) as { id: number; userId: number };
  expect(body.userId, "Angelegte Schicht muss dem richtigen Nutzer gehoeren").toBe(aliceA);
});
