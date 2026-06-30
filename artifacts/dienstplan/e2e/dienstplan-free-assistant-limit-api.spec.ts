import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test: Ein frisch registriertes Free-Konto kann genau so viele Assistenten
 * anlegen, wie das Free-Limit (maxAssistants = 6) erlaubt, und wird beim nächsten
 * mit 403 {code:"plan_limit_reached", limit:"maxAssistants"} blockiert.
 *
 * Hintergrund (#216): Das Free-Limit maxAssistants war bisher nur als
 * Frontend-UX vorhanden, NICHT serverseitig durchgesetzt. Der Client ist nicht
 * vertrauenswürdig — ein Free-Konto könnte über direkte API-Aufrufe das Limit
 * umgehen. Analog zu maxShiftModels (#205/#207, E2E #209) wird das Limit jetzt
 * autoritativ im POST /api/users erzwungen. Dieser Test prüft den Free-Pfad
 * end-to-end gegen ein eigens registriertes Free-Konto (Default-Plan `free`),
 * unabhängig vom (auf Premium gesetzten) Standard-Test-Admin:
 *
 * - Registrierung legt einen Admin (Plan `free`) inkl. Standard-Team an und
 *   meldet ihn an (Session-Cookie im Request-Kontext). Der Admin selbst zählt
 *   NICHT gegen das Assistenten-Limit.
 * - Das Anlegen der ersten 6 Assistenten gelingt (201).
 * - Das Anlegen des 7. Assistenten wird mit 403
 *   {code:"plan_limit_reached", limit:"maxAssistants"} abgelehnt.
 *
 * Läuft rein über die API gegen den isolierten Test-Stack.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";
const FREE_MAX_ASSISTANTS = 6;

type AuthUser = { id: number; plan: string; accountType: string };
type User = { id: number; name: string; role: string };

let ctx: APIRequestContext;
let owner: AuthUser;
const createdUserIds: number[] = [];

test.beforeAll(async () => {
  const unique = Date.now();
  ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const res = await ctx.post("/api/auth/register", {
    data: {
      name: `E2E Free Assistant Limit ${unique}`,
      email: `e2e.free.assistant.${unique}@dienstplan.test`,
      password: "freeaccount1234",
      accountType: "privat",
    },
  });
  expect(res.status(), "Registrierung sollte 201 liefern").toBe(201);
  owner = (await res.json()) as AuthUser;
  // Default-Plan eines neu registrierten Kontos ist Free.
  expect(owner.plan, "Neues Konto sollte Plan 'free' haben").toBe("free");
});

test.afterAll(async () => {
  // Best-effort-Cleanup in der isolierten Test-DB, FK-sicher: erst die angelegten
  // Assistenten, dann das Team, dann das registrierte Konto. Fehlschläge
  // blockieren andere Specs nicht.
  const tryDelete = async (path: string) => {
    try {
      await ctx.delete(path);
    } catch {
      /* ignore */
    }
  };

  for (const id of createdUserIds) await tryDelete(`/api/users/${id}`);
  try {
    const teamsRes = await ctx.get("/api/teams");
    if (teamsRes.ok()) {
      const teams = (await teamsRes.json()) as { id: number }[];
      for (const t of teams) await tryDelete(`/api/teams/${t.id}`);
    }
  } catch {
    /* ignore */
  }
  if (owner?.id) await tryDelete(`/api/users/${owner.id}`);
  await ctx.dispose();
});

test("Free-Konto kann genau 6 Assistenten anlegen, der 7. wird mit 403 plan_limit_reached blockiert", async () => {
  const unique = Date.now();

  // --- Die ersten 6 Assistenten: erlaubt (201) ---
  for (let i = 1; i <= FREE_MAX_ASSISTANTS; i++) {
    const okRes = await ctx.post("/api/users", {
      data: {
        name: `Assistent ${i}`,
        email: `e2e.assistant.${unique}.${i}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(okRes.status(), `Assistent ${i} sollte 201 liefern`).toBe(201);
    const created = (await okRes.json()) as User;
    createdUserIds.push(created.id);
  }

  // --- 7. Assistent: blockiert (403 plan_limit_reached) ---
  const blockedRes = await ctx.post("/api/users", {
    data: {
      name: "Ein Assistent zu viel",
      email: `e2e.assistant.${unique}.over@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(blockedRes.status(), "7. Assistent sollte am Free-Limit 403 liefern").toBe(403);
  const body = (await blockedRes.json()) as { code?: string; limit?: string };
  expect(body.code).toBe("plan_limit_reached");
  expect(body.limit).toBe("maxAssistants");
});
