import {
  test,
  expect,
  type APIRequestContext,
} from "@playwright/test";
import { TeamTestHarness, type SeededAdmin } from "./helpers/teams";

/**
 * E2E-/API-Test für das Write-Scoping beim Anlegen von Schichtmodellen
 * (Multi-Team Stufe 3, #44). Sicherheitsrelevant: ein Admin darf KEIN
 * Schichtmodell in einem fremden Team anlegen — sonst ließen sich über
 * `POST /api/shift-models` Wertungs-/Zuschlagsmodelle in fremde Mandanten
 * einschleusen. Die Route nutzt `resolveWriteTeamId` und lehnt ein fremdes
 * `teamId` mit 403 ab.
 *
 * Der bestehende `dienstplan-team-scoping.spec.ts` prüft nur das Anlegen im
 * EIGENEN Team; das Anlegen mit fremdem `teamId` war bisher NICHT automatisch
 * getestet. Die by-id-Operationen (PATCH/DELETE) deckt
 * `dienstplan-shift-model-team-idor.spec.ts` ab. Dieser Test schließt die
 * verbleibende Lücke beim Anlegen.
 *
 * Aufbau (rein über die API, analog zu `dienstplan-shift-model-team-idor.spec.ts`):
 * - Dienstleister A = der Setup-Admin, zur Laufzeit auf accountType
 *   "dienstleister" geschaltet. Besitzt ein frisch angelegtes Team (A).
 * - Admin B = ein zweiter, über das setup-admin-Skript geseedeter Admin OHNE
 *   Teams (reiner "Angreifer"). Für ihn ist Team A "fremd"; ein
 *   `POST /api/shift-models` mit `teamId = teamA` muss mit 403 abgelehnt werden.
 *
 * Geprüft (Done-Kriterien der Aufgabe):
 * - POST /shift-models mit fremdem `teamId` (als Admin B) -> 403.
 * - Sanity: POST /shift-models mit eigenem `teamId` (als Dienstleister A) -> 201.
 *
 * Alle Testdaten (Team, das angelegte Modell, der geseedete Admin B) werden in
 * afterAll wieder entfernt; der accountType von A wird zurückgesetzt.
 */

type Entity = { id: number };

let harness: TeamTestHarness;
let adminCtx: APIRequestContext; // Dienstleister A (Datenbesitzer)
let attacker: SeededAdmin; // Admin B (fremder Admin ohne Teams)
let attackerCtx: APIRequestContext;

let teamA: number;
let createdModel = 0; // im Sanity-Test angelegtes Modell (für Cleanup)

test.beforeAll(async () => {
  // --- Dienstleister A einloggen und zum Dienstleister machen ---
  harness = await TeamTestHarness.login();
  await harness.becomeDienstleister();
  adminCtx = harness.ctx;

  // --- Ein Team für A anlegen ---
  teamA = await harness.createTeam(`E2E SM-Create Team A ${harness.run}`);

  // --- Admin B (fremder Admin ohne Teams) seeden ---
  attacker = await harness.seedForeignAdmin();
  attackerCtx = attacker.ctx;
});

test.afterAll(async () => {
  // Das im Sanity-Test angelegte Modell vor dem Team entfernen (DELETE /teams
  // liefert sonst 409, solange Daten am Team hängen).
  if (createdModel) {
    try {
      await adminCtx.delete(`/api/shift-models/${createdModel}`);
    } catch {
      /* ignore */
    }
  }

  await harness.cleanup();
});

test.describe("Schichtmodell anlegen: fremdes Team ist nicht erlaubt", () => {
  test("POST /shift-models mit fremdem teamId (Team A) als Admin B -> 403", async () => {
    const res = await attackerCtx.post("/api/shift-models", {
      data: {
        name: `E2E SM-Create fremd ${harness.run}`,
        valuationPercent: 100,
        color: "#cc3333",
        sortOrder: 999,
        isActive: true,
        teamId: teamA,
      },
    });
    expect(res.status()).toBe(403);
  });

  test("Sanity: POST /shift-models mit eigenem teamId (Team A) als Dienstleister A -> 201", async () => {
    const res = await adminCtx.post("/api/shift-models", {
      data: {
        name: `E2E SM-Create eigen ${harness.run}`,
        valuationPercent: 100,
        color: "#3366cc",
        sortOrder: 999,
        isActive: true,
        teamId: teamA,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    createdModel = ((await res.json()) as Entity).id;
    expect(createdModel).toBeGreaterThan(0);
  });
});
