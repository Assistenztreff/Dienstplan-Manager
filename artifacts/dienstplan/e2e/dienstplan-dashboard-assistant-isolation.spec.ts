import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * API-Test für die userId-personale Datensicht des Dashboards aus Sicht eines
 * Assistenten (`role: "assistant"`).
 *
 * Schwester-Test zu dienstplan-dashboard-isolation.spec.ts: jener prüft die
 * Team-Datentrennung NUR für Admins (Dienstleister). Der Assistant-Branch von
 * `GET /api/dashboard/summary` liefert hingegen bewusst rein userId-personale
 * Daten (eigene Schichten, eigene Ist-Zeiten, keine Team-Aggregate). Dieser
 * Pfad war bisher von keinem Test abgedeckt — eine versehentliche Aufweichung
 * (z. B. Wegfall des `eq(...userId)`-Filters) würde einem Assistenten fremde
 * Daten zeigen, ohne dass es auffällt.
 *
 * Aufbau (rein über die API):
 * - Admin (Setup-Admin) legt zwei Assistenten an: das Testsubjekt ("me") und
 *   einen zweiten Assistenten ("other"), dessen Daten "me" NICHT sehen darf.
 * - Beide bekommen je eine Schicht (8 h) und eine Ist-Zeit (Status pending) in
 *   einem dedizierten, weit in der Zukunft liegenden Monat (MONTH/YEAR), damit
 *   die eigenen Aggregate exakt den frisch angelegten Daten entsprechen und die
 *   eigene Schicht zuverlässig als "anstehend" (startTime >= heute) gilt.
 * - "me" setzt per Einladungs-Token ein Passwort und loggt sich selbst ein.
 *
 * Geprüft (Done-Kriterien der Aufgabe):
 * - `totalAssistants` ist null (kein Team-Zähler für Assistenten).
 * - `upcomingShifts`/`recentTimeEntries` enthalten nur eigene Datensätze,
 *   keine des anderen Assistenten.
 * - `monthlyPlannedHours`/`pendingTimeEntries` entsprechen exakt den eigenen
 *   Daten.
 * - `GET /api/dashboard/hours-balance` ist für Assistenten tabu (requireAdmin
 *   -> 403).
 *
 * Alle Testdaten werden in afterAll wieder entfernt.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Dedizierter Monat weit in der Zukunft: macht die eigenen Aggregate
// deterministisch (keine Kollision mit Bestandsdaten) und sorgt dafür, dass die
// eigene Schicht als "anstehend" (startTime >= heute) in upcomingShifts
// erscheint.
// Dynamischer Zielmonat = nächster Monat: liegt für jeden Plan (auch Free,
// historyMonths=1) im erlaubten Vorausplanungs-Fenster und ist sicher zukünftig
// (upcomingShifts). Kollisionsschutz braucht es nicht: alle Aggregate sind auf
// frisch angelegte Teams/Nutzer gescoped.
const TARGET = new Date();
TARGET.setDate(1);
TARGET.setMonth(TARGET.getMonth() + 1);
const YEAR = TARGET.getFullYear();
const MONTH = TARGET.getMonth() + 1;
const MM = String(MONTH).padStart(2, "0");
const DAY_SHIFT = `${YEAR}-${MM}-10`;
const DAY_TIME = `${YEAR}-${MM}-11`;
const SHIFT_HOURS = 8;

// Eindeutiger Suffix, damit parallele/wiederholte Läufe nicht kollidieren.
const RUN = Date.now();
const MY_PASSWORD = `Pw${RUN}!secure`;

type Entity = { id: number };
type LoginResponse = { id: number; role: string };

let adminCtx: APIRequestContext; // legt Testdaten an, räumt auf
let assistantCtx: APIRequestContext; // das Testsubjekt ("me")

let myId: number; // Assistent "me"
let otherId: number; // zweiter Assistent

let myShift: number;
let otherShift: number;
let myTime: number;
let otherTime: number;

async function createUser(data: Record<string, unknown>): Promise<number> {
  const res = await adminCtx.post("/api/users", { data });
  expect(res.ok(), `Nutzer anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

async function createShift(userId: number, day: string): Promise<number> {
  const res = await adminCtx.post("/api/shifts", {
    data: {
      userId,
      startTime: `${day}T08:00:00.000Z`,
      endTime: `${day}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(res.ok(), `Schicht anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

async function createTimeEntry(userId: number, day: string): Promise<number> {
  const res = await adminCtx.post("/api/time-tracking", {
    data: {
      userId,
      actualStart: `${day}T08:00:00.000Z`,
      actualEnd: `${day}T16:00:00.000Z`,
    },
  });
  expect(res.ok(), `Ist-Zeit anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Entity).id;
}

test.beforeAll(async () => {
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);

  myId = await createUser({
    name: `E2E Dash Me ${RUN}`,
    email: `e2e.dash.me.${RUN}@dienstplan.test`,
    role: "assistant",
  });
  otherId = await createUser({
    name: `E2E Dash Other ${RUN}`,
    email: `e2e.dash.other.${RUN}@dienstplan.test`,
    role: "assistant",
  });

  myShift = await createShift(myId, DAY_SHIFT);
  otherShift = await createShift(otherId, DAY_SHIFT);
  myTime = await createTimeEntry(myId, DAY_TIME);
  otherTime = await createTimeEntry(otherId, DAY_TIME);

  // "me" ein Passwort setzen (Einladungs-Token) und als Assistent einloggen.
  const inviteRes = await adminCtx.post(`/api/users/${myId}/invite`, {});
  expect(inviteRes.ok(), "Einladung fehlgeschlagen").toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const pwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: MY_PASSWORD },
  });
  expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);

  const meLogin = await assistantCtx.post("/api/auth/login", {
    data: { email: `e2e.dash.me.${RUN}@dienstplan.test`, password: MY_PASSWORD },
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

  for (const id of [myTime, otherTime]) if (id) await tryDelete(`/api/time-tracking/${id}`);
  for (const id of [myShift, otherShift]) if (id) await tryDelete(`/api/shifts/${id}`);
  for (const id of [myId, otherId]) if (id) await tryDelete(`/api/users/${id}`);

  await adminCtx.dispose();
  await assistantCtx?.dispose();
});

type SummaryResponse = {
  totalAssistants: number | null;
  monthlyPlannedHours: number;
  pendingTimeEntries: number;
  upcomingShifts: { id: number }[];
  recentTimeEntries: { id: number }[];
};

test.describe("Dashboard-Summary als Assistent (nur eigene Daten)", () => {
  test("liefert ausschließlich die eigenen Datensätze", async () => {
    const res = await assistantCtx.get(
      `/api/dashboard/summary?month=${MONTH}&year=${YEAR}`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as SummaryResponse;

    // Kein Team-Zähler für Assistenten.
    expect(body.totalAssistants).toBeNull();

    // Aggregate entsprechen exakt den eigenen Daten (eine Schicht, eine Ist-Zeit).
    expect(body.monthlyPlannedHours).toBe(SHIFT_HOURS);
    expect(body.pendingTimeEntries).toBe(1);

    // upcomingShifts: nur die eigene Schicht, nicht die des anderen Assistenten.
    const shiftIds = body.upcomingShifts.map((s) => s.id);
    expect(shiftIds).toContain(myShift);
    expect(shiftIds).not.toContain(otherShift);

    // recentTimeEntries: nur die eigene Ist-Zeit, nicht die des anderen.
    const timeIds = body.recentTimeEntries.map((t) => t.id);
    expect(timeIds).toContain(myTime);
    expect(timeIds).not.toContain(otherTime);
  });
});

test.describe("Dashboard-Stundenbilanz ist für Assistenten tabu", () => {
  test("GET /api/dashboard/hours-balance -> 403", async () => {
    const res = await assistantCtx.get(
      `/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}`,
    );
    expect([401, 403]).toContain(res.status());
  });
});
