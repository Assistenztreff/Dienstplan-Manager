import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test: Ein eingeloggter Assistent (`role: "assistant"`) darf KEINE
 * Team-Verwaltung betreiben — weder Teams anlegen/ändern/löschen noch Mitglieder
 * hinzufügen/entfernen.
 *
 * Die Team-Endpunkte (`/api/teams` und Mitgliedschafts-Endpunkte) sind über die
 * `requireDienstleister`-Middleware geschützt (Admin + accountType
 * `dienstleister`). Auf API-Ebene war das bisher nicht durch einen automatischen
 * Test abgesichert. Eine versehentliche Lockerung (z. B. `requireAuth` oder
 * `requireAdmin` statt `requireDienstleister`) würde einem Assistenten — oder
 * einem privat-Admin — ungewollt Zugriff auf Team-CRUD geben, ohne dass es
 * auffällt.
 *
 * Aufbau (rein über die API):
 * - Admin (Setup-Admin) legt einen Assistenten an.
 * - Der Assistent setzt per Einladungs-Token ein Passwort und loggt sich ein.
 * - Jeder schreibende Team-Endpunkt wird aus der Assistenten-Session aufgerufen
 *   und muss 403 (bzw. 401) liefern. `requireDienstleister` greift VOR jeder
 *   DB-Operation, daher genügt für die :id-basierten Endpunkte eine beliebige
 *   Team-ID — die Middleware blockt, bevor das Team überhaupt geladen wird.
 *
 * Alle Testdaten werden in afterAll wieder entfernt.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const RUN = Date.now();
const MY_PASSWORD = `Pw${RUN}!secure`;
const MY_EMAIL = `e2e.team.me.${RUN}@dienstplan.test`;

// Beliebige Team-ID: requireDienstleister blockt VOR jeder DB-Operation, daher
// muss das Team nicht existieren, um den 403/401 auszulösen.
const SOME_TEAM_ID = 999999;
const SOME_USER_ID = 999998;

type Entity = { id: number };
type LoginResponse = { id: number; role: string };

let adminCtx: APIRequestContext; // legt Testdaten an, räumt auf
let assistantCtx: APIRequestContext; // das Testsubjekt

let myId: number;

async function createAsAdmin(path: string, data: Record<string, unknown>): Promise<number> {
  const res = await adminCtx.post(path, { data });
  expect(res.ok(), `Anlegen ${path} fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

test.beforeAll(async () => {
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);

  myId = await createAsAdmin("/api/users", {
    name: `E2E Team Me ${RUN}`,
    email: MY_EMAIL,
    role: "assistant",
  });

  // Assistent: Passwort per Einladungs-Token setzen und einloggen.
  const inviteRes = await adminCtx.post(`/api/users/${myId}/invite`, {});
  expect(inviteRes.ok(), "Einladung fehlgeschlagen").toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const pwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: MY_PASSWORD },
  });
  expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);

  const meLogin = await assistantCtx.post("/api/auth/login", {
    data: { email: MY_EMAIL, password: MY_PASSWORD },
  });
  expect(meLogin.ok(), "Assistenten-Login fehlgeschlagen").toBe(true);
  const me = (await meLogin.json()) as LoginResponse;
  expect(me.role).toBe("assistant");
});

test.afterAll(async () => {
  if (myId) {
    try {
      await adminCtx.delete(`/api/users/${myId}`);
    } catch {
      /* ignore */
    }
  }
  await adminCtx.dispose();
  await assistantCtx?.dispose();
});

const FORBIDDEN = [401, 403];

test.describe("Assistent darf keine Teams verwalten", () => {
  test("POST /api/teams -> 403", async () => {
    const res = await assistantCtx.post("/api/teams", {
      data: { name: `E2E Forbidden Team ${RUN}` },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("PATCH /api/teams/:id -> 403", async () => {
    const res = await assistantCtx.patch(`/api/teams/${SOME_TEAM_ID}`, {
      data: { name: `Geändert ${RUN}` },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("DELETE /api/teams/:id -> 403", async () => {
    const res = await assistantCtx.delete(`/api/teams/${SOME_TEAM_ID}`);
    expect(FORBIDDEN).toContain(res.status());
  });
});

test.describe("Assistent darf keine Mitgliedschaften verwalten", () => {
  test("POST /api/teams/:id/members -> 403", async () => {
    const res = await assistantCtx.post(`/api/teams/${SOME_TEAM_ID}/members`, {
      data: { userId: SOME_USER_ID },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("DELETE /api/teams/:id/members/:userId -> 403", async () => {
    const res = await assistantCtx.delete(
      `/api/teams/${SOME_TEAM_ID}/members/${SOME_USER_ID}`,
    );
    expect(FORBIDDEN).toContain(res.status());
  });
});
