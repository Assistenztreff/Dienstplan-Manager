import {
  test,
  expect,
  type APIRequestContext,
} from "@playwright/test";
import { TeamTestHarness, type SeededAdmin } from "./helpers/teams";

/**
 * E2E-/API-Test für das Write-Scoping beim Anlegen von Schichten und Verträgen
 * (Multi-Team Stufe 3, #44). Sicherheitsrelevant: ein Admin darf KEINE Schicht
 * und KEINEN Vertrag in einem fremden Team anlegen — sonst ließen sich über
 * `POST /api/shifts` bzw. `POST /api/contracts` Daten in fremde Mandanten
 * einschleusen. Beide Routen nutzen `resolveWriteTeamId` und lehnen ein fremdes
 * `teamId` mit 403 ab (noch vor der Member-of-Team-Prüfung).
 *
 * Analog zu `dienstplan-shift-model-create-team-scope.spec.ts` (#77) schließt
 * dieser Test die verbleibende Lücke beim ANLEGEN: die bestehenden Tests decken
 * nur das Anlegen im EIGENEN Team sowie die by-id-Operationen (IDOR) und die
 * Listen-Scopes ab — das Anlegen mit fremdem `teamId` war bisher NICHT
 * automatisch getestet.
 *
 * Aufbau (rein über die API):
 * - Dienstleister A = der Setup-Admin, zur Laufzeit auf accountType
 *   "dienstleister" geschaltet. Besitzt ein frisch angelegtes Team (A) mit einem
 *   Mitglieds-Assistenten (für die Sanity-201-Fälle, da die Member-of-Team-
 *   Invariante einen Team-Mitglieds-userId verlangt).
 * - Admin B = ein zweiter, über das setup-admin-Skript geseedeter Admin OHNE
 *   Teams (reiner "Angreifer"). Für ihn ist Team A "fremd"; ein POST mit
 *   `teamId = teamA` muss mit 403 abgelehnt werden.
 *
 * Geprüft (Done-Kriterien der Aufgabe):
 * - POST /shifts mit fremdem `teamId` (als Admin B) -> 403; Sanity eigen -> 201.
 * - POST /contracts mit fremdem `teamId` (als Admin B) -> 403; Sanity eigen -> 201.
 *
 * Alle Testdaten (Team, Mitglied, angelegte Schicht/Vertrag, der geseedete
 * Admin B) werden in afterAll wieder entfernt; der accountType von A wird
 * zurückgesetzt.
 */

type Entity = { id: number };

let harness: TeamTestHarness;
let adminCtx: APIRequestContext; // Dienstleister A (Datenbesitzer)
let attacker: SeededAdmin; // Admin B (fremder Admin ohne Teams)
let attackerCtx: APIRequestContext;

let teamA: number;
let memberId: number; // Mitglied von Team A (für die Sanity-201-Fälle)

let createdShift = 0; // im Sanity-Test angelegte Schicht (für Cleanup)
let createdContract = 0; // im Sanity-Test angelegter Vertrag (für Cleanup)

test.beforeAll(async () => {
  // --- Dienstleister A einloggen und zum Dienstleister machen ---
  harness = await TeamTestHarness.login();
  await harness.becomeDienstleister();
  adminCtx = harness.ctx;

  // --- Ein Team für A anlegen + einen Mitglieds-Assistenten ---
  teamA = await harness.createTeam(`E2E SC-Create Team A ${harness.run}`);
  memberId = await harness.createUser({ teamId: teamA, role: "assistant" });

  // --- Admin B (fremder Admin ohne Teams) seeden ---
  attacker = await harness.seedForeignAdmin();
  attackerCtx = attacker.ctx;
});

test.afterAll(async () => {
  // Im Sanity-Test angelegte Daten vor dem Team entfernen (DELETE /teams liefert
  // sonst 409, solange Daten am Team hängen).
  if (createdShift) {
    try {
      await adminCtx.delete(`/api/shifts/${createdShift}`);
    } catch {
      /* ignore */
    }
  }
  if (createdContract) {
    try {
      await adminCtx.delete(`/api/contracts/${createdContract}`);
    } catch {
      /* ignore */
    }
  }

  await harness.cleanup();
});

test.describe("Schicht anlegen: fremdes Team ist nicht erlaubt", () => {
  test("POST /shifts mit fremdem teamId (Team A) als Admin B -> 403", async () => {
    const res = await attackerCtx.post("/api/shifts", {
      data: {
        userId: memberId,
        teamId: teamA,
        startTime: "2026-07-01T08:00:00.000Z",
        endTime: "2026-07-01T16:00:00.000Z",
        type: "active",
      },
    });
    expect(res.status()).toBe(403);
  });

  test("Sanity: POST /shifts mit eigenem teamId (Team A) als Dienstleister A -> 201", async () => {
    const res = await adminCtx.post("/api/shifts", {
      data: {
        userId: memberId,
        teamId: teamA,
        startTime: "2026-07-02T08:00:00.000Z",
        endTime: "2026-07-02T16:00:00.000Z",
        type: "active",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    createdShift = ((await res.json()) as Entity).id;
    expect(createdShift).toBeGreaterThan(0);
  });
});

test.describe("Vertrag anlegen: fremdes Team ist nicht erlaubt", () => {
  test("POST /contracts mit fremdem teamId (Team A) als Admin B -> 403", async () => {
    const res = await attackerCtx.post("/api/contracts", {
      data: {
        userId: memberId,
        teamId: teamA,
        weeklyHours: 40,
        vacationDays: 30,
        startDate: "2026-01-01",
      },
    });
    expect(res.status()).toBe(403);
  });

  test("Sanity: POST /contracts mit eigenem teamId (Team A) als Dienstleister A -> 201", async () => {
    const res = await adminCtx.post("/api/contracts", {
      data: {
        userId: memberId,
        teamId: teamA,
        weeklyHours: 40,
        vacationDays: 30,
        startDate: "2026-02-01",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    createdContract = ((await res.json()) as Entity).id;
    expect(createdContract).toBeGreaterThan(0);
  });
});
