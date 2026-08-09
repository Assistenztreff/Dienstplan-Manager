import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test: Ein eingeloggter Admin mit Konto-Typ "privat" darf KEINE
 * Team-Verwaltung betreiben — weder Teams anlegen/ändern/löschen noch Mitglieder
 * hinzufügen/entfernen.
 *
 * Die Team-Endpunkte (`/api/teams` und Mitgliedschafts-Endpunkte) sind über die
 * `requireDienstleister`-Middleware geschützt (Admin + accountType
 * `dienstleister`). Der Schwester-Test
 * `dienstplan-assistant-team-write-forbidden.spec.ts` deckt nur die
 * Rollen-Prüfung (Assistent) ab. Eine Lockerung von `requireDienstleister` auf
 * `requireAdmin` würde dort NICHT auffallen — genau diesen Fall sichert dieser
 * Test ab: Der Setup-Admin (admin@dienstplan.local) hat die Admin-Rolle, aber
 * accountType "privat", und muss trotzdem 403 erhalten.
 *
 * Aufbau (rein über die API):
 * - Login als Setup-Admin (existiert bereits in der Test-DB, accountType
 *   "privat" — Absicherung via /api/auth/me im beforeAll).
 * - Jeder schreibende Team-Endpunkt wird aus dieser Session aufgerufen und muss
 *   403 (bzw. 401) liefern. `requireDienstleister` greift VOR jeder
 *   DB-Operation, daher genügt für die :id-basierten Endpunkte eine beliebige
 *   Team-ID — die Middleware blockt, bevor das Team überhaupt geladen wird.
 *
 * Es werden keine Testdaten angelegt, daher ist kein Aufräumen nötig.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const RUN = Date.now();

// Beliebige Team-ID: requireDienstleister blockt VOR jeder DB-Operation, daher
// muss das Team nicht existieren, um den 403/401 auszulösen.
const SOME_TEAM_ID = 999999;
const SOME_USER_ID = 999998;

type MeResponse = { role: string; accountType: string };

let privatAdminCtx: APIRequestContext; // das Testsubjekt

test.beforeAll(async () => {
  privatAdminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await privatAdminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);

  // Vorbedingung absichern: Der Setup-Admin ist Admin, aber Konto-Typ "privat".
  // Wäre er Dienstleister, würde dieser Test nichts beweisen.
  const meRes = await privatAdminCtx.get("/api/auth/me");
  expect(meRes.ok(), "auth/me fehlgeschlagen").toBe(true);
  const me = (await meRes.json()) as MeResponse;
  expect(me.role).toBe("admin");
  expect(me.accountType).toBe("privat");
});

test.afterAll(async () => {
  await privatAdminCtx?.dispose();
});

const FORBIDDEN = [401, 403];

test.describe("Privat-Admin darf keine Teams verwalten", () => {
  test("POST /api/teams -> 403", async () => {
    const res = await privatAdminCtx.post("/api/teams", {
      data: { name: `E2E Privat Forbidden Team ${RUN}` },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("PATCH /api/teams/:id -> 403", async () => {
    const res = await privatAdminCtx.patch(`/api/teams/${SOME_TEAM_ID}`, {
      data: { name: `Geändert ${RUN}` },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("DELETE /api/teams/:id -> 403", async () => {
    const res = await privatAdminCtx.delete(`/api/teams/${SOME_TEAM_ID}`);
    expect(FORBIDDEN).toContain(res.status());
  });
});

// Mitgliedschaften: Seit der Vereinheitlichung der Team-Verwaltung pflegt AUCH
// ein Privat-Konto die Assistenzkräfte seines EIGENEN Teams — die Mitglieder-
// Endpunkte sind daher nicht mehr auf Dienstleister beschränkt. Die Grenze ist
// jetzt der Team-Scope: ein fremdes (oder nicht existierendes) Team antwortet
// mit 404, damit die Antwort nicht verrät, ob es das Team überhaupt gibt.
const KEIN_ZUGRIFF = [401, 403, 404];

test.describe("Privat-Admin kommt nicht an fremde Mitgliedschaften", () => {
  test("POST /api/teams/:id/members -> kein Zugriff", async () => {
    const res = await privatAdminCtx.post(`/api/teams/${SOME_TEAM_ID}/members`, {
      data: { userId: SOME_USER_ID },
    });
    expect(KEIN_ZUGRIFF).toContain(res.status());
  });

  test("DELETE /api/teams/:id/members/:userId -> kein Zugriff", async () => {
    const res = await privatAdminCtx.delete(
      `/api/teams/${SOME_TEAM_ID}/members/${SOME_USER_ID}`,
    );
    expect(KEIN_ZUGRIFF).toContain(res.status());
  });
});
