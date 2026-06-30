import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test: Ein frisch registriertes Free-DIENSTLEISTER-Konto darf genau das
 * eine bei der Registrierung angelegte "Standard-Team" behalten und wird beim
 * Versuch, ein ZWEITES Team anzulegen, am Free-Limit (maxTeams = 1) mit 403
 * {code:"plan_limit_reached", limit:"maxTeams"} blockiert.
 *
 * Hintergrund (#217): maxTeams war bisher nur Frontend-/Konfigurations-Gate und
 * NICHT serverseitig durchgesetzt — ein Free-Dienstleister konnte per direktem
 * POST /api/teams beliebig viele Teams anlegen. Dieser Test deckt die nun
 * autoritative Server-Durchsetzung end-to-end ab (analog zum maxShiftModels-
 * Test). Bestandsschutz: das bei der Registrierung erzeugte Standard-Team bleibt
 * erhalten, nur das Anlegen eines WEITEREN Teams ueber dem Limit wird gesperrt.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack und ist unabhaengig
 * vom (auf Premium gesetzten) Test-Admin. Das Konto wird mit accountType
 * "dienstleister" registriert, da das Team-Anlegen requireDienstleister verlangt.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

type AuthUser = { id: number; plan: string; accountType: string };
type Team = { id: number; name: string };

let ctx: APIRequestContext;
let user: AuthUser;

test.beforeAll(async () => {
  const unique = Date.now();
  ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const res = await ctx.post("/api/auth/register", {
    data: {
      name: `E2E Free Team Limit ${unique}`,
      email: `e2e.free.team.${unique}@dienstplan.test`,
      password: "freeaccount1234",
      accountType: "dienstleister",
    },
  });
  expect(res.status(), "Registrierung sollte 201 liefern").toBe(201);
  user = (await res.json()) as AuthUser;
  // Default-Plan eines neu registrierten Kontos ist Free.
  expect(user.plan, "Neues Konto sollte Plan 'free' haben").toBe("free");
  expect(user.accountType, "Konto sollte Dienstleister sein").toBe("dienstleister");
});

test.afterAll(async () => {
  // Best-effort-Cleanup in der isolierten Test-DB, FK-sicher: ein Team laesst
  // sich nur loeschen, wenn keine Daten/Mitglieder mehr haengen — daher pro Team
  // erst die (bei der Registrierung geseedeten) Dienste, dann die Mitglieder,
  // dann das Team selbst; zuletzt das registrierte Konto. Fehlschlaege blockieren
  // andere Specs nicht.
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
      const models = (await modelsRes.json()) as { id: number }[];
      for (const m of models) await tryDelete(`/api/shift-models/${m.id}`);
    }
  } catch {
    /* ignore */
  }
  try {
    const teamsRes = await ctx.get("/api/teams");
    if (teamsRes.ok()) {
      const teams = (await teamsRes.json()) as { id: number }[];
      for (const t of teams) {
        const membersRes = await ctx.get(`/api/teams/${t.id}/members`);
        if (membersRes.ok()) {
          const members = (await membersRes.json()) as { userId: number }[];
          for (const m of members) await tryDelete(`/api/teams/${t.id}/members/${m.userId}`);
        }
        await tryDelete(`/api/teams/${t.id}`);
      }
    }
  } catch {
    /* ignore */
  }
  if (user?.id) await tryDelete(`/api/users/${user.id}`);
  await ctx.dispose();
});

test("Free-Dienstleister behaelt das eine Standard-Team, ein zweites wird mit 403 plan_limit_reached blockiert", async () => {
  // --- Start: genau das eine bei der Registrierung angelegte Standard-Team ---
  const seededRes = await ctx.get("/api/teams");
  expect(seededRes.ok(), "GET /api/teams fehlgeschlagen").toBe(true);
  const seeded = (await seededRes.json()) as Team[];
  expect(seeded.length, "Neues Free-Dienstleister-Konto sollte mit 1 Team starten").toBe(1);

  // --- 2. Team: blockiert (403 plan_limit_reached) ---
  const blockedRes = await ctx.post("/api/teams", {
    data: { name: "Zweites Team" },
  });
  expect(blockedRes.status(), "2. Team sollte am Free-Limit 403 liefern").toBe(403);
  const body = (await blockedRes.json()) as { code?: string; limit?: string };
  expect(body.code).toBe("plan_limit_reached");
  expect(body.limit).toBe("maxTeams");

  // Es wurde KEIN 2. Team angelegt (Bestandsschutz: weiterhin genau 1).
  const finalRes = await ctx.get("/api/teams");
  const finalTeams = (await finalRes.json()) as Team[];
  expect(finalTeams.length, "Der abgelehnte Versuch darf kein Team anlegen").toBe(1);
});
