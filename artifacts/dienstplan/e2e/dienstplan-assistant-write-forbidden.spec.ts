import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test: Ein eingeloggter Assistent (`role: "assistant"`) darf KEINE
 * schreibenden Endpunkte auf Schichten, Verträgen und Schichtmodellen ausführen.
 *
 * Der bestehende UI-Test (dienstplan-assistant.spec.ts) prüft nur, dass die
 * Oberfläche keine Buttons/Dialoge zum Anlegen/Ändern zeigt. Auf API-Ebene war
 * bisher nicht abgesichert, dass die `requireAdmin`-Middleware POST/PATCH/DELETE
 * für Assistenten blockt. Eine versehentliche Lockerung (z. B. `requireAuth`
 * statt `requireAdmin`) würde einem Assistenten ungewollt Schreibrechte geben,
 * ohne dass es auffällt.
 *
 * Aufbau (rein über die API):
 * - Admin (Setup-Admin) legt einen Assistenten an und je eine reale Schicht,
 *   einen Vertrag und ein Schichtmodell, deren IDs als PATCH/DELETE-Ziele dienen.
 * - Der Assistent setzt per Einladungs-Token ein Passwort und loggt sich ein.
 * - Jeder schreibende Endpunkt wird aus der Assistenten-Session aufgerufen und
 *   muss 403 (bzw. 401) liefern; die `requireAdmin`-Middleware greift VOR jeder
 *   DB-Operation, daher bleiben die Bestandsdaten unangetastet.
 *
 * Alle Testdaten werden in afterAll wieder entfernt.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Dynamischer Zielmonat = nächster Monat: liegt für jeden Plan (auch Free,
// historyMonths=1) innerhalb des erlaubten Vorausplanungs-Fensters.
const TARGET = new Date();
TARGET.setDate(1);
TARGET.setMonth(TARGET.getMonth() + 1);
const YEAR = TARGET.getFullYear();
const MONTH = TARGET.getMonth() + 1;
const DAY_SHIFT = `${YEAR}-${String(MONTH).padStart(2, "0")}-10`;

const RUN = Date.now();
const MY_PASSWORD = `Pw${RUN}!secure`;
const MY_EMAIL = `e2e.write.me.${RUN}@dienstplan.test`;

type Entity = { id: number };
type LoginResponse = { id: number; role: string };

let adminCtx: APIRequestContext; // legt Testdaten an, räumt auf
let assistantCtx: APIRequestContext; // das Testsubjekt

let myId: number;
let shiftId: number;
let contractId: number;
let shiftModelId: number;

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
    name: `E2E Write Me ${RUN}`,
    email: MY_EMAIL,
    role: "assistant",
  });

  shiftId = await createAsAdmin("/api/shifts", {
    userId: myId,
    startTime: `${DAY_SHIFT}T08:00:00.000Z`,
    endTime: `${DAY_SHIFT}T16:00:00.000Z`,
    type: "active",
  });

  contractId = await createAsAdmin("/api/contracts", {
    userId: myId,
    weeklyHours: 40,
    vacationDays: 30,
    startDate: `${YEAR}-01-01`,
  });

  shiftModelId = await createAsAdmin("/api/shift-models", {
    name: `E2E Write Model ${RUN}`,
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
  const tryDelete = async (path: string) => {
    try {
      await adminCtx.delete(path);
    } catch {
      /* ignore */
    }
  };

  if (shiftModelId) await tryDelete(`/api/shift-models/${shiftModelId}`);
  if (contractId) await tryDelete(`/api/contracts/${contractId}`);
  if (shiftId) await tryDelete(`/api/shifts/${shiftId}`);
  if (myId) await tryDelete(`/api/users/${myId}`);

  await adminCtx.dispose();
  await assistantCtx?.dispose();
});

const FORBIDDEN = [401, 403];

test.describe("Assistent darf keine Schichten schreiben", () => {
  test("POST /api/shifts -> 403", async () => {
    const res = await assistantCtx.post("/api/shifts", {
      data: {
        userId: myId,
        startTime: `${DAY_SHIFT}T18:00:00.000Z`,
        endTime: `${DAY_SHIFT}T20:00:00.000Z`,
        type: "active",
      },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("PATCH /api/shifts/:id -> 403", async () => {
    const res = await assistantCtx.patch(`/api/shifts/${shiftId}`, {
      data: { type: "standby" },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("DELETE /api/shifts/:id -> 403", async () => {
    const res = await assistantCtx.delete(`/api/shifts/${shiftId}`);
    expect(FORBIDDEN).toContain(res.status());
  });
});

test.describe("Assistent darf keine Verträge schreiben", () => {
  test("POST /api/contracts -> 403", async () => {
    const res = await assistantCtx.post("/api/contracts", {
      data: {
        userId: myId,
        weeklyHours: 20,
        vacationDays: 25,
        startDate: `${YEAR}-02-01`,
      },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("PATCH /api/contracts/:id -> 403", async () => {
    const res = await assistantCtx.patch(`/api/contracts/${contractId}`, {
      data: { weeklyHours: 10 },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("DELETE /api/contracts/:id -> 403", async () => {
    const res = await assistantCtx.delete(`/api/contracts/${contractId}`);
    expect(FORBIDDEN).toContain(res.status());
  });
});

test.describe("Assistent darf keine Schichtmodelle schreiben", () => {
  test("POST /api/shift-models -> 403", async () => {
    const res = await assistantCtx.post("/api/shift-models", {
      data: { name: `E2E Forbidden Model ${RUN}` },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("PATCH /api/shift-models/:id -> 403", async () => {
    const res = await assistantCtx.patch(`/api/shift-models/${shiftModelId}`, {
      data: { name: `Geändert ${RUN}` },
    });
    expect(FORBIDDEN).toContain(res.status());
  });

  test("DELETE /api/shift-models/:id -> 403", async () => {
    const res = await assistantCtx.delete(`/api/shift-models/${shiftModelId}`);
    expect(FORBIDDEN).toContain(res.status());
  });
});

test.describe("Bestandsdaten bleiben nach den Schreibversuchen unverändert", () => {
  test("Schicht, Vertrag und Schichtmodell existieren weiterhin", async () => {
    const shiftRes = await adminCtx.get(`/api/shifts/${shiftId}`);
    expect(shiftRes.status()).toBe(200);

    const contractRes = await adminCtx.get(`/api/contracts/${contractId}`);
    expect(contractRes.status()).toBe(200);

    const modelRes = await adminCtx.get("/api/shift-models");
    expect(modelRes.status()).toBe(200);
    const models = (await modelRes.json()) as Entity[];
    expect(models.map((m) => m.id)).toContain(shiftModelId);
  });
});
