import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test: Ein frisch registriertes Free-Konto kann genau EINEN eigenen Dienst
 * anlegen und wird dann am Free-Limit (maxShiftModels = 5) blockiert.
 *
 * Hintergrund (#207/#209): Das Free-Limit wurde bewusst auf 5 gesetzt (4
 * geseedete Standard-Dienste + 1 eigener), damit ein neues Free-Konto nicht
 * bereits am Limit startet, sondern noch mindestens einen eigenen Dienst
 * anlegen kann. Die bestehende Test-DB setzt den Standard-Admin auf Premium,
 * daher war der Free-Pfad bisher nur indirekt abgedeckt. Dieser Test prüft ihn
 * end-to-end gegen ein eigens registriertes Free-Konto (Default-Plan `free`):
 *
 * - Registrierung legt einen Admin (Plan `free`) inkl. Standard-Team an und
 *   meldet ihn an (Session-Cookie im Request-Kontext).
 * - GET /api/shift-models liefert die 4 geseedeten Standard-Dienste.
 * - Das Anlegen des 5. Dienstes (1. eigener) gelingt (201).
 * - Das Anlegen des 6. Dienstes wird mit 403
 *   {code:"plan_limit_reached", limit:"maxShiftModels"} abgelehnt.
 *
 * Läuft rein über die API gegen den isolierten Test-Stack und ist unabhängig
 * vom (auf Premium gesetzten) Test-Admin.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

type AuthUser = { id: number; plan: string; accountType: string };
type ShiftModel = { id: number; name: string };

let ctx: APIRequestContext;
let user: AuthUser;
const createdModelIds: number[] = [];

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

test("Free-Konto kann genau einen eigenen Dienst anlegen, der nächste wird mit 403 plan_limit_reached blockiert", async () => {
  // --- Start: genau die 4 geseedeten Standard-Dienste ---
  const seededRes = await ctx.get("/api/shift-models");
  expect(seededRes.ok(), "GET /api/shift-models fehlgeschlagen").toBe(true);
  const seeded = (await seededRes.json()) as ShiftModel[];
  expect(seeded.length, "Neues Free-Konto sollte mit 4 Standard-Diensten starten").toBe(4);

  // --- 5. Dienst (1. eigener): erlaubt (201) ---
  const okRes = await ctx.post("/api/shift-models", {
    data: { name: "Mein eigener Dienst", valuationPercent: 100 },
  });
  expect(okRes.status(), "5. Dienst (1. eigener) sollte 201 liefern").toBe(201);
  const created = (await okRes.json()) as ShiftModel;
  createdModelIds.push(created.id);

  // Jetzt sind es 5 Dienste (am Free-Limit).
  const afterRes = await ctx.get("/api/shift-models");
  const after = (await afterRes.json()) as ShiftModel[];
  expect(after.length, "Nach dem eigenen Dienst sollten es 5 sein").toBe(5);

  // --- 6. Dienst: blockiert (403 plan_limit_reached) ---
  const blockedRes = await ctx.post("/api/shift-models", {
    data: { name: "Ein Dienst zu viel", valuationPercent: 100 },
  });
  expect(blockedRes.status(), "6. Dienst sollte am Free-Limit 403 liefern").toBe(403);
  const body = (await blockedRes.json()) as { code?: string; limit?: string };
  expect(body.code).toBe("plan_limit_reached");
  expect(body.limit).toBe("maxShiftModels");

  // Es wurde KEIN 6. Dienst angelegt (weiterhin 5).
  const finalRes = await ctx.get("/api/shift-models");
  const finalModels = (await finalRes.json()) as ShiftModel[];
  expect(finalModels.length, "Der abgelehnte Versuch darf keinen Dienst anlegen").toBe(5);
});
