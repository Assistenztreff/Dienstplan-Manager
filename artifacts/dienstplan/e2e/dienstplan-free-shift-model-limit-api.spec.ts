import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { DEFAULT_SHIFT_MODELS } from "@workspace/shift-defaults";
import { PLAN_CONFIG } from "@workspace/entitlements";

/**
 * API-Test: Das Free-Limit für Schichtmodelle (`maxShiftModels`) zählt und
 * blockiert das Anlegen darüber — blendet aber nichts aus (Bestandsschutz:
 * vorhandene Modelle bleiben nutzbar und löschbar).
 *
 * HINWEIS ZUR HISTORIE (30.08.2026): Früher setzte dieser Test voraus, dass ein
 * frisches Free-Konto mit fünf geseedeten Standard-Diensten startet und damit
 * zufällig GENAU am Limit steht. Seit die Seed-Liste auf die Teamsitzung
 * reduziert wurde, stimmt das nicht mehr — ein Free-Konto startet unter dem
 * Limit und darf eigene Dienste anlegen. Das ist gewollt: das Limit ist eine
 * Tarifgrenze, die Seed-Liste eine Starthilfe; sie zufällig gleich groß zu
 * halten war nie die Zusicherung.
 *
 * Der Test füllt deshalb jetzt SELBST bis ans Limit auf und leitet beide
 * Zahlen aus der Quelle ab (`DEFAULT_SHIFT_MODELS`, `PLAN_CONFIG`), statt sie
 * abzuschreiben. Ändert sich eine davon, wandert der Test mit.
 *
 * Läuft rein über die API gegen den isolierten Test-Stack und ist unabhängig
 * vom (auf Premium gesetzten) Test-Admin.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

/** Free-Limit und Seed-Anzahl aus der Quelle, nicht abgeschrieben. */
const LIMIT = PLAN_CONFIG.free.limits.maxShiftModels!;
const SEEDS = DEFAULT_SHIFT_MODELS.length;

type AuthUser = { id: number; plan: string; accountType: string };
type ShiftModel = { id: number; name: string };

let ctx: APIRequestContext;
let user: AuthUser;

test.beforeAll(async () => {
  const unique = Date.now();
  ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const res = await ctx.post("/api/auth/register", {
    data: {
      name: `E2E Free Limit ${unique}`,
      email: `e2e.free.limit.${unique}@dienstplan.test`,
      password: "freeaccount1234",
      accountType: "privat",
    },
  });
  expect(res.status(), "Registrierung sollte 201 liefern").toBe(201);
  user = (await res.json()) as AuthUser;
  // Default-Plan eines neu registrierten Kontos ist Free.
  expect(user.plan, "Neues Konto sollte Plan 'free' haben").toBe("free");
});

test.afterAll(async () => {
  // Best-effort-Cleanup in der isolierten Test-DB, FK-sicher: erst ALLE Dienste
  // des Teams (geseedete + eigens angelegte), dann das Team, dann das
  // registrierte Konto. Fehlschläge blockieren andere Specs nicht.
  const tryDelete = async (path: string) => {
    try {
      await ctx.delete(path);
    } catch {
      /* ignore */
    }
  };

  try {
    const modelsRes = await ctx.get("/api/shift-models");
    if (modelsRes.ok()) {
      const models = (await modelsRes.json()) as ShiftModel[];
      for (const m of models) await tryDelete(`/api/shift-models/${m.id}`);
    }
  } catch {
    /* ignore */
  }
  try {
    const teamsRes = await ctx.get("/api/teams");
    if (teamsRes.ok()) {
      const teams = (await teamsRes.json()) as { id: number }[];
      for (const t of teams) await tryDelete(`/api/teams/${t.id}`);
    }
  } catch {
    /* ignore */
  }
  if (user?.id) await tryDelete(`/api/users/${user.id}`);
  await ctx.dispose();
});

test("Das Free-Limit blockiert den Dienst darueber; nach dem Loeschen eines Dienstes geht es wieder", async () => {
  // --- Start: die geseedeten Standard-Dienste, UNTER dem Limit ---
  const seededRes = await ctx.get("/api/shift-models");
  expect(seededRes.ok(), "GET /api/shift-models fehlgeschlagen").toBe(true);
  const seeded = (await seededRes.json()) as ShiftModel[];
  expect(
    seeded.length,
    `Neues Free-Konto sollte mit ${SEEDS} Standard-Dienst(en) starten`,
  ).toBe(SEEDS);
  expect(
    SEEDS,
    "Vorbedingung dieses Tests: die Seeds allein duerfen das Limit nicht schon fuellen",
  ).toBeLessThanOrEqual(LIMIT);

  // --- Selbst bis ans Limit auffuellen ---
  for (let i = seeded.length; i < LIMIT; i++) {
    const res = await ctx.post("/api/shift-models", {
      data: { name: `Eigener Dienst ${i}`, valuationPercent: 100 },
    });
    expect(res.status(), `Dienst ${i + 1} unter dem Limit sollte 201 liefern`).toBe(201);
  }
  const amLimitRes = await ctx.get("/api/shift-models");
  const amLimit = (await amLimitRes.json()) as ShiftModel[];
  expect(amLimit.length, "Jetzt genau am Limit").toBe(LIMIT);

  // --- Ein Dienst zu viel: blockiert (403 plan_limit_reached) ---
  const blockedRes = await ctx.post("/api/shift-models", {
    data: { name: "Ein Dienst zu viel", valuationPercent: 100 },
  });
  expect(blockedRes.status(), "Ueber dem Free-Limit sollte 403 kommen").toBe(403);
  const body = (await blockedRes.json()) as { code?: string; limit?: string };
  expect(body.code).toBe("plan_limit_reached");
  expect(body.limit).toBe("maxShiftModels");

  // Es wurde KEIN Dienst angelegt.
  const afterBlockRes = await ctx.get("/api/shift-models");
  const afterBlock = (await afterBlockRes.json()) as ShiftModel[];
  expect(afterBlock.length, "Der abgelehnte Versuch darf keinen Dienst anlegen").toBe(LIMIT);

  // --- Bestandsschutz-Gegenprobe: ein Dienst ist loeschbar ---
  const deleteRes = await ctx.delete(`/api/shift-models/${afterBlock[afterBlock.length - 1]!.id}`);
  expect(deleteRes.ok(), "Ein vorhandener Dienst sollte loeschbar sein").toBe(true);

  // --- Unter dem Limit: ein eigener Dienst ist wieder erlaubt (201) ---
  const allowedRes = await ctx.post("/api/shift-models", {
    data: { name: "Eigener Dienst nach Loeschen", valuationPercent: 100 },
  });
  expect(
    allowedRes.status(),
    `Unter dem Limit sollte das Anlegen 201 liefern (${await allowedRes.text()})`,
  ).toBe(201);
});
