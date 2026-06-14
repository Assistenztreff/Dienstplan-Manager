import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-/API-Test für die team-bezogene Validierung des Schichtmodells einer
 * Schicht (Multi-Team, #47). Sicherheitsrelevant: eine Schicht darf nur mit
 * einem Schichtmodell aus dem eigenen Team verknüpft werden, sonst flössen die
 * Wertungs-/Zuschlagsparameter eines fremden Teams in die Auswertung ein.
 *
 * Diese Regel war bisher nur manuell per curl geprüft; dieser Test schützt sie
 * gegen unbemerkte Regressionen.
 *
 * Aufbau (rein über die API): Der Setup-Admin wird zur Laufzeit auf accountType
 * "dienstleister" geschaltet und legt zwei Teams (A und B) mit je einem
 * Schichtmodell sowie einem Mitglied an. Damit lassen sich eigenes vs. fremdes
 * Modell gegeneinander prüfen.
 *
 * Geprüft (Done-Kriterien der Aufgabe):
 * - POST /api/shifts mit shiftModelId eines fremden Teams -> 403.
 * - POST /api/shifts mit eigenem Modell -> 201.
 * - PATCH /api/shifts/:id auf ein Fremdmodell -> 403; auf ein eigenes -> 200.
 *
 * Alle angelegten Testdaten werden in afterAll wieder entfernt; der accountType
 * des Admins wird auf den Ausgangswert zurückgesetzt.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Eindeutiger Suffix, damit wiederholte Läufe nicht kollidieren.
const RUN = Date.now();

type LoginResponse = { id: number; accountType: "privat" | "dienstleister" };
type Entity = { id: number };

let adminCtx: APIRequestContext;
let adminId: number;
let originalAccountType: "privat" | "dienstleister";

let teamA: number;
let teamB: number;
let modelA: number; // Schichtmodell in Team A (eigenes Modell)
let modelB: number; // Schichtmodell in Team B (fremdes Modell)
let aliceId: number; // Mitglied von Team A
let ownShiftId: number; // mit eigenem Modell angelegte Schicht (für PATCH-Tests)

async function createTeam(name: string): Promise<number> {
  const res = await adminCtx.post("/api/teams", { data: { name } });
  expect(res.ok(), `Team anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

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

async function createMember(teamId: number, label: string): Promise<number> {
  const res = await adminCtx.post("/api/users", {
    data: {
      name: `E2E ${label} ${RUN}`,
      email: `e2e.${label.toLowerCase()}.${RUN}@dienstplan.test`,
      role: "assistant",
      teamId,
    },
  });
  expect(res.ok(), `Nutzer anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

test.beforeAll(async () => {
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);
  const login = (await loginRes.json()) as LoginResponse;
  adminId = login.id;
  originalAccountType = login.accountType;

  const switchRes = await adminCtx.patch(`/api/users/${adminId}`, {
    data: { accountType: "dienstleister" },
  });
  expect(switchRes.ok(), "Konto-Typ-Wechsel fehlgeschlagen").toBe(true);

  teamA = await createTeam(`E2E SM Team A ${RUN}`);
  teamB = await createTeam(`E2E SM Team B ${RUN}`);
  modelA = await createShiftModel(teamA, `E2E Modell A ${RUN}`);
  modelB = await createShiftModel(teamB, `E2E Modell B ${RUN}`);
  aliceId = await createMember(teamA, "Alice");
});

test.afterAll(async () => {
  const tryDelete = async (path: string) => {
    try {
      await adminCtx.delete(path);
    } catch {
      /* ignore */
    }
  };

  // FK-sichere Reihenfolge: Schichten -> Modelle/Nutzer -> Teams.
  if (ownShiftId) await tryDelete(`/api/shifts/${ownShiftId}`);
  for (const id of [modelA, modelB]) if (id) await tryDelete(`/api/shift-models/${id}`);
  if (aliceId) await tryDelete(`/api/users/${aliceId}`);
  for (const id of [teamA, teamB]) if (id) await tryDelete(`/api/teams/${id}`);

  if (adminId && originalAccountType) {
    try {
      await adminCtx.patch(`/api/users/${adminId}`, {
        data: { accountType: originalAccountType },
      });
    } catch {
      /* ignore */
    }
  }

  await adminCtx.dispose();
});

test.describe("Schicht akzeptiert nur Schichtmodelle des eigenen Teams", () => {
  test("POST /shifts mit Fremdmodell (Team B) für eine Schicht in Team A -> 403", async () => {
    const res = await adminCtx.post("/api/shifts", {
      data: {
        userId: aliceId,
        teamId: teamA,
        startTime: "2026-08-01T08:00:00.000Z",
        endTime: "2026-08-01T16:00:00.000Z",
        type: "active",
        shiftModelId: modelB,
      },
    });
    expect(res.status()).toBe(403);
  });

  test("POST /shifts mit eigenem Modell (Team A) -> 201", async () => {
    const res = await adminCtx.post("/api/shifts", {
      data: {
        userId: aliceId,
        teamId: teamA,
        startTime: "2026-08-02T08:00:00.000Z",
        endTime: "2026-08-02T16:00:00.000Z",
        type: "active",
        shiftModelId: modelA,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    ownShiftId = ((await res.json()) as Entity).id;
  });

  test("PATCH /shifts/:id auf ein Fremdmodell (Team B) -> 403", async () => {
    expect(ownShiftId, "Voraussetzung: eigene Schicht wurde angelegt").toBeTruthy();
    const res = await adminCtx.patch(`/api/shifts/${ownShiftId}`, {
      data: { shiftModelId: modelB },
    });
    expect(res.status()).toBe(403);
  });

  test("PATCH /shifts/:id auf ein eigenes Modell (Team A) -> 200", async () => {
    expect(ownShiftId, "Voraussetzung: eigene Schicht wurde angelegt").toBeTruthy();
    const res = await adminCtx.patch(`/api/shifts/${ownShiftId}`, {
      data: { shiftModelId: modelA },
    });
    expect(res.status(), await res.text()).toBe(200);
  });
});
