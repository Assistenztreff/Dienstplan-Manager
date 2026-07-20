import {
  test,
  expect,
  type APIRequestContext,
} from "@playwright/test";
import { TeamTestHarness, enableTimeTracking, type SeededAdmin } from "./helpers/teams";

/**
 * E2E-/API-Test für das Write-Scoping beim Anlegen von Ist-Zeiten
 * (Multi-Team Stufe 3, #44). Sicherheitsrelevant: ein Admin darf KEINE Ist-Zeit
 * an einer Schicht aus einem fremden Team erfassen — sonst ließen sich über
 * `POST /api/time-tracking` Daten in fremde Mandanten einschleusen. Die Ist-Zeit
 * erbt das `teamId` von der verknüpften Schicht; liegt dieses Team nicht im
 * Berechtigungsumfang des erfassenden Nutzers (`getAllowedTeamIds`), wird der
 * Schreibzugriff mit 404 abgelehnt — identisch zur Antwort für nicht
 * existierende shiftIds, damit die Existenz teamfremder Schichten nicht per
 * Statuscode ausspähbar ist (kein Fehler-Orakel, Task #547; Details:
 * dienstplan-time-tracking-create-oracle-api.spec.ts).
 *
 * Analog zu `dienstplan-shift-contract-create-team-scope.spec.ts` (#97) schließt
 * dieser Test die verbleibende Lücke beim ANLEGEN von Ist-Zeiten: #97 deckte
 * bewusst nur shifts und contracts ab.
 *
 * Aufbau (rein über die API):
 * - Dienstleister A = der Setup-Admin, zur Laufzeit auf accountType
 *   "dienstleister" geschaltet. Besitzt ein frisch angelegtes Team (A) mit einem
 *   Mitglieds-Assistenten und zwei Schichten dieses Mitglieds (eine für den
 *   403-Angriff, eine für den Sanity-201-Fall).
 * - Admin B = ein zweiter, über das setup-admin-Skript geseedeter Admin OHNE
 *   Teams (reiner "Angreifer"). Für ihn ist Team A "fremd"; ein POST mit einer
 *   `shiftId` aus Team A muss mit 404 abgelehnt werden.
 *
 * Der Angreifer erfasst die Ist-Zeit für den legitimen Schicht-Inhaber
 * (`userId = memberId`): selbst mit korrektem Inhaber darf die Antwort nur
 * 404 sein — der Team-Scope-Check läuft VOR dem `shift_not_owned`-Guard.
 *
 * Geprüft (Done-Kriterien der Aufgabe):
 * - POST /time-tracking mit fremder shiftId (Team A) als Admin B -> 404.
 * - Sanity: POST /time-tracking für eine Schicht im eigenen Team -> 201.
 *
 * Alle Testdaten (Team, Mitglied, Schichten, angelegte Ist-Zeit, der geseedete
 * Admin B) werden in afterAll wieder entfernt; der accountType von A wird
 * zurückgesetzt.
 */

type Entity = { id: number };

let harness: TeamTestHarness;
let adminCtx: APIRequestContext; // Dienstleister A (Datenbesitzer)
let attacker: SeededAdmin; // Admin B (fremder Admin ohne Teams)
let attackerCtx: APIRequestContext;

let teamA: number;
let memberId: number; // Mitglied von Team A (Schicht-Inhaber)
let shiftForAttack = 0; // Schicht in Team A, auf die Admin B abzielt
let shiftForSanity = 0; // Schicht in Team A für den Sanity-201-Fall

let createdEntry = 0; // im Sanity-Test angelegte Ist-Zeit (für Cleanup)

test.beforeAll(async () => {
  // --- Dienstleister A einloggen und zum Dienstleister machen ---
  harness = await TeamTestHarness.login();
  await harness.becomeDienstleister();
  adminCtx = harness.ctx;
  // Konto-Schalter „Zeiterfassung aktivieren" (Standard AUS) einschalten,
  // damit der Sanity-201-Fall nicht am neuen Gate scheitert. Der Angriffs-Fall
  // bleibt 404 (Team-Scope-Check greift vor dem Gate).
  await enableTimeTracking(adminCtx);

  // --- Ein Team für A anlegen + einen Mitglieds-Assistenten + Schichten ---
  teamA = await harness.createTeam(`E2E TT-Create Team A ${harness.run}`);
  memberId = await harness.createUser({ teamId: teamA, role: "assistant" });
  shiftForAttack = await harness.createShift(teamA, memberId, "2026-07-01");
  shiftForSanity = await harness.createShift(teamA, memberId, "2026-07-02");

  // --- Admin B (fremder Admin ohne Teams) seeden ---
  attacker = await harness.seedForeignAdmin();
  attackerCtx = attacker.ctx;
});

test.afterAll(async () => {
  // Im Sanity-Test angelegte Ist-Zeit vor dem Team entfernen (DELETE /teams
  // liefert sonst 409, solange Daten am Team hängen).
  if (createdEntry) {
    try {
      await adminCtx.delete(`/api/time-tracking/${createdEntry}`);
    } catch {
      /* ignore */
    }
  }

  await harness.cleanup();
});

test.describe("Ist-Zeit anlegen: fremdes Team ist nicht erlaubt", () => {
  test("POST /time-tracking mit fremder shiftId (Team A) als Admin B -> 404", async () => {
    const res = await attackerCtx.post("/api/time-tracking", {
      data: {
        userId: memberId,
        shiftId: shiftForAttack,
        actualStart: "2026-07-01T08:00:00.000Z",
        actualEnd: "2026-07-01T16:00:00.000Z",
      },
    });
    // 404 statt 403: fremde shiftIds antworten wie nicht existierende, damit
    // ein fremder Admin weder Existenz noch Buchungsstand ausspähen kann.
    expect(res.status()).toBe(404);
  });

  test("Sanity: POST /time-tracking für eigene Schicht (Team A) als Dienstleister A -> 201", async () => {
    const res = await adminCtx.post("/api/time-tracking", {
      data: {
        userId: memberId,
        shiftId: shiftForSanity,
        actualStart: "2026-07-02T08:00:00.000Z",
        actualEnd: "2026-07-02T16:00:00.000Z",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    createdEntry = ((await res.json()) as Entity).id;
    expect(createdEntry).toBeGreaterThan(0);
  });
});
