import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test: Ein frisch registriertes Free-Konto startet mit den 5 geseedeten
 * Standard-Diensten (Frühdienst, Spätdienst, Nachtdienst, Bereitschaft,
 * 24h Dienst) und damit bewusst genau AM Free-Limit (maxShiftModels = 5).
 *
 * Hintergrund: Produktentscheidung — die 5 Standard-Dienste bleiben beim
 * Seeding erhalten, das Free-Limit entspricht exakt der Seed-Anzahl. Ein
 * weiterer (eigener) Dienst ist im Free-Tarif erst nach dem Löschen eines
 * Standard-Dienstes möglich (Bestandsschutz: vorhandene Modelle bleiben voll
 * nutzbar/löschbar, nur das Anlegen ÜBER dem Limit ist gesperrt).
 * Die bestehende Test-DB setzt den Standard-Admin auf Premium, daher prüft
 * dieser Test den Free-Pfad end-to-end gegen ein eigens registriertes
 * Free-Konto (Default-Plan `free`):
 *
 * - Registrierung legt einen Admin (Plan `free`) inkl. Standard-Team an und
 *   meldet ihn an (Session-Cookie im Request-Kontext).
 * - GET /api/shift-models liefert die 5 geseedeten Standard-Dienste.
 * - Das Anlegen eines 6. Dienstes wird mit 403
 *   {code:"plan_limit_reached", limit:"maxShiftModels"} abgelehnt.
 * - Nach dem Löschen eines Standard-Dienstes (4 verbleibend) gelingt das
 *   Anlegen eines eigenen Dienstes (201) — das Limit zählt, blendet aber
 *   nichts aus.
 *
 * Läuft rein über die API gegen den isolierten Test-Stack und ist unabhängig
 * vom (auf Premium gesetzten) Test-Admin.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

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

test("Free-Konto startet am Limit (5 Seeds): 6. Dienst wird blockiert, nach Löschen eines Seeds ist ein eigener Dienst erlaubt", async () => {
  // --- Start: genau die 5 geseedeten Standard-Dienste (= am Free-Limit) ---
  const seededRes = await ctx.get("/api/shift-models");
  expect(seededRes.ok(), "GET /api/shift-models fehlgeschlagen").toBe(true);
  const seeded = (await seededRes.json()) as ShiftModel[];
  expect(seeded.length, "Neues Free-Konto sollte mit 5 Standard-Diensten starten").toBe(5);

  // --- 6. Dienst: blockiert (403 plan_limit_reached) ---
  const blockedRes = await ctx.post("/api/shift-models", {
    data: { name: "Ein Dienst zu viel", valuationPercent: 100 },
  });
  expect(blockedRes.status(), "6. Dienst sollte am Free-Limit 403 liefern").toBe(403);
  const body = (await blockedRes.json()) as { code?: string; limit?: string };
  expect(body.code).toBe("plan_limit_reached");
  expect(body.limit).toBe("maxShiftModels");

  // Es wurde KEIN 6. Dienst angelegt (weiterhin 5).
  const afterBlockRes = await ctx.get("/api/shift-models");
  const afterBlock = (await afterBlockRes.json()) as ShiftModel[];
  expect(afterBlock.length, "Der abgelehnte Versuch darf keinen Dienst anlegen").toBe(5);

  // --- Bestandsschutz-Gegenprobe: ein Standard-Dienst ist löschbar ---
  const deleteRes = await ctx.delete(`/api/shift-models/${seeded[seeded.length - 1]!.id}`);
  expect(deleteRes.ok(), "Standard-Dienst sollte löschbar sein").toBe(true);

  // --- Unter dem Limit (4): ein eigener Dienst ist wieder erlaubt (201) ---
  const okRes = await ctx.post("/api/shift-models", {
    data: { name: "Mein eigener Dienst", valuationPercent: 100 },
  });
  expect(okRes.status(), "Eigener Dienst unter dem Limit sollte 201 liefern").toBe(201);

  // Jetzt wieder 5 Dienste (am Free-Limit).
  const finalRes = await ctx.get("/api/shift-models");
  const finalModels = (await finalRes.json()) as ShiftModel[];
  expect(finalModels.length, "Nach dem eigenen Dienst sollten es wieder 5 sein").toBe(5);
});
