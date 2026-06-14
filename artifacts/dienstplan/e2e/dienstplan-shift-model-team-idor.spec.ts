import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { TeamTestHarness, type SeededAdmin } from "./helpers/teams";

/**
 * E2E-/API-Test für den IDOR-Schutz der by-id-Operationen auf Schichtmodellen
 * (Multi-Team Stufe 3, #44). Sicherheitsrelevant: ein Schichtmodell eines
 * fremden Teams darf weder geändert (PATCH /api/shift-models/:id) noch gelöscht
 * (DELETE /api/shift-models/:id) werden — sonst ließen sich die Wertungs-/
 * Zuschlagsparameter fremder Teams manipulieren oder Modelle fremder Mandanten
 * entfernen.
 *
 * Der bestehende `dienstplan-team-scoping.spec.ts` deckt nur das Listen-Scoping
 * und das Anlegen ab; die by-id-Schreiboperationen waren bisher NICHT
 * automatisch getestet. Dieser Test schließt die Lücke.
 *
 * Aufbau (rein über die API, analog zu `dienstplan-team-isolation.spec.ts`):
 * - Dienstleister A = der Setup-Admin, zur Laufzeit auf accountType
 *   "dienstleister" geschaltet. Besitzt zwei frisch angelegte Teams (A und B)
 *   mit je einem Schichtmodell (modelA, modelB).
 * - Admin B = ein zweiter, über das setup-admin-Skript geseedeter Admin OHNE
 *   Teams (reiner "Angreifer"). Für ihn sind beide Modelle "fremd" und müssen
 *   404 liefern. Ein 404 entsteht nur aus dieser Fremd-Perspektive: A besitzt
 *   beide Teams und dürfte beide Modelle ändern/löschen.
 *
 * Geprüft (Done-Kriterien der Aufgabe):
 * - PATCH /shift-models/:id eines fremden Teams (als Admin B) -> 404.
 * - DELETE /shift-models/:id eines fremden Teams (als Admin B) -> 404.
 * - Sanity: PATCH/DELETE des eigenen Modells (als Dienstleister A) -> 200/204.
 *
 * Alle Testdaten (Teams, Modelle, der geseedete Admin B) werden in afterAll
 * wieder entfernt; der accountType von A wird auf den Ausgangswert zurückgesetzt.
 */

type Entity = { id: number };

let harness: TeamTestHarness;
let adminCtx: APIRequestContext; // Dienstleister A (Datenbesitzer)
let attacker: SeededAdmin; // Admin B (fremder Admin ohne Teams)
let attackerCtx: APIRequestContext;

let teamA: number;
let teamB: number;
let modelA: number; // Schichtmodell in Team A
let modelB: number; // Schichtmodell in Team B

/**
 * Legt ein Schichtmodell im angegebenen Team an (über A's Dienstleister-Kontext).
 * Der Harness kapselt Teams/Nutzer/Schichten, aber keine Schichtmodelle, daher
 * lokal.
 */
async function createShiftModel(teamId: number, name: string): Promise<number> {
  const res = await adminCtx.post("/api/shift-models", {
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
  // --- Dienstleister A einloggen und zum Dienstleister machen ---
  harness = await TeamTestHarness.login();
  await harness.becomeDienstleister();
  adminCtx = harness.ctx;

  // --- Zwei Teams mit je einem Schichtmodell anlegen ---
  teamA = await harness.createTeam(`E2E SM-IDOR Team A ${harness.run}`);
  teamB = await harness.createTeam(`E2E SM-IDOR Team B ${harness.run}`);
  modelA = await createShiftModel(teamA, `E2E SM-IDOR Modell A ${harness.run}`);
  modelB = await createShiftModel(teamB, `E2E SM-IDOR Modell B ${harness.run}`);

  // --- Admin B (fremder Admin ohne Teams) seeden ---
  attacker = await harness.seedForeignAdmin();
  attackerCtx = attacker.ctx;
});

test.afterAll(async () => {
  // Schichtmodelle vor den Teams entfernen (DELETE /teams liefert sonst 409,
  // solange Daten am Team hängen). Best-effort: bereits gelöschte Modelle
  // (z. B. modelB nach dem Sanity-DELETE) ignorieren.
  const tryDelete = async (path: string) => {
    try {
      await adminCtx.delete(path);
    } catch {
      /* ignore */
    }
  };
  for (const id of [modelA, modelB]) if (id) await tryDelete(`/api/shift-models/${id}`);

  await harness.cleanup();
});

test.describe("Schichtmodell-IDOR: fremdes Team kann nicht geändert/gelöscht werden", () => {
  test("PATCH /shift-models/:id eines fremden Teams (Team A) als Admin B -> 404", async () => {
    const res = await attackerCtx.patch(`/api/shift-models/${modelA}`, {
      data: { name: `gehackt ${Date.now()}` },
    });
    expect(res.status()).toBe(404);
  });

  test("DELETE /shift-models/:id eines fremden Teams (Team B) als Admin B -> 404", async () => {
    const res = await attackerCtx.delete(`/api/shift-models/${modelB}`);
    expect(res.status()).toBe(404);
  });

  test("Sanity: das fremd nicht löschbare Modell (Team B) existiert weiterhin (gescopt sichtbar)", async () => {
    const res = await adminCtx.get(`/api/shift-models?teamId=${teamB}`);
    expect(res.ok(), `${res.status()}`).toBe(true);
    const models = (await res.json()) as Entity[];
    expect(models.some((m) => m.id === modelB)).toBe(true);
  });

  test("Sanity: Dienstleister A kann sein eigenes Modell (Team A) ändern -> 200", async () => {
    const res = await adminCtx.patch(`/api/shift-models/${modelA}`, {
      data: { name: `E2E SM-IDOR Modell A geändert ${harness.run}` },
    });
    expect(res.status(), await res.text()).toBe(200);
  });

  test("Sanity: Dienstleister A kann sein eigenes Modell (Team B) löschen -> 204", async () => {
    const res = await adminCtx.delete(`/api/shift-models/${modelB}`);
    expect(res.status()).toBe(204);
  });
});
