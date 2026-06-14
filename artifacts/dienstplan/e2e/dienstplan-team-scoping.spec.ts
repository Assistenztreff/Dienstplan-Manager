import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test für die strikte, backend-seitige Team-Datentrennung (Multi-Team Stufe 3).
 *
 * Diese Tests sprechen die API direkt an (kein UI), da die Datentrennung
 * sicherheitsrelevant ist und unabhängig vom Frontend gelten muss. Der Setup-Admin
 * ist ein "privat"-Konto (kein Dienstleister), daher werden erlaubte Team-IDs aus
 * gescopten Domänendaten (Schichten) abgeleitet statt über die Dienstleister-only
 * Route GET /api/teams.
 *
 * Deckt ab:
 * - GET /api/users mit fremdem teamId -> 403 (kein Zugriff auf fremdes Team).
 * - POST /api/users ordnet einen neuen Nutzer dem Team des Erstellers zu, sodass er
 *   in der gescopten (KEIN globaler Pool) GET /api/users-Liste sichtbar ist.
 * - POST /api/users mit fremdem teamId -> 403 (Write-Scoping).
 * - Ein Schichtmodell, das mit teamId angelegt wird, landet im gewählten Team und
 *   ist in der gescopten Liste sichtbar.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

const FOREIGN_TEAM_ID = 999999;

type AppUser = { id: number };
type ShiftModel = { id: number; teamId?: number };

let adminCtx: APIRequestContext;
/** Eine bekannte, erlaubte Team-ID (aus einem existierenden Schichtmodell abgeleitet). */
let knownTeamId: number | undefined;

test.beforeAll(async () => {
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login fehlgeschlagen").toBe(true);

  // teamId ist im ShiftModel-DTO enthalten (anders als im Shift-DTO); daraus
  // leiten wir eine bekannte erlaubte Team-ID ab.
  const modelsRes = await adminCtx.get("/api/shift-models");
  expect(modelsRes.ok(), "Schichtmodelle konnten nicht geladen werden").toBe(true);
  const models = (await modelsRes.json()) as ShiftModel[];
  knownTeamId = models.find((m) => typeof m.teamId === "number")?.teamId;
});

test.afterAll(async () => {
  await adminCtx.dispose();
});

test.describe("Team-Datentrennung (Backend-Scoping)", () => {
  test("GET /users mit fremdem teamId liefert 403", async () => {
    const res = await adminCtx.get(`/api/users?teamId=${FOREIGN_TEAM_ID}`);
    expect(res.status()).toBe(403);
  });

  test("POST /users ordnet neuen Nutzer dem Team zu und er erscheint in der gescopten Liste", async () => {
    // Ohne teamId: der neue Nutzer wird dem Standard-Team des Erstellers zugeordnet,
    // damit er in der gescopten (nicht globalen) Liste sichtbar bleibt.
    const unique = Date.now();
    const createRes = await adminCtx.post("/api/users", {
      data: {
        name: `E2E Teammitglied ${unique}`,
        email: `e2e.member.${unique}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(createRes.ok(), `Anlegen fehlgeschlagen (${createRes.status()})`).toBe(true);
    const created = (await createRes.json()) as AppUser;

    try {
      const scopedRes = await adminCtx.get("/api/users");
      expect(scopedRes.ok()).toBe(true);
      const scoped = (await scopedRes.json()) as AppUser[];
      const ids = new Set(scoped.map((u) => u.id));

      // Die Liste ist gescoped (kein globaler Pool), aber der neue Nutzer wurde dem
      // Team des Erstellers zugeordnet und MUSS daher sichtbar sein.
      expect(ids.has(created.id), "Neuer Nutzer fehlt in gescopter Liste").toBe(true);
    } finally {
      await adminCtx.delete(`/api/users/${created.id}`);
    }
  });

  test("POST /users mit fremdem teamId liefert 403", async () => {
    const unique = Date.now();
    const res = await adminCtx.post("/api/users", {
      data: {
        name: `E2E Fremd ${unique}`,
        email: `e2e.foreign.${unique}@dienstplan.test`,
        role: "assistant",
        teamId: FOREIGN_TEAM_ID,
      },
    });
    expect(res.status()).toBe(403);
  });

  test("Schichtmodell mit teamId landet im gewählten Team und ist gescoped sichtbar", async () => {
    test.skip(knownTeamId == null, "Kein erlaubtes Team aus Schichten ableitbar");
    const teamId = knownTeamId!;
    const name = `E2E Modell ${Date.now()}`;

    const createRes = await adminCtx.post("/api/shift-models", {
      data: {
        name,
        valuationPercent: 100,
        color: "#3366cc",
        sortOrder: 999,
        isActive: true,
        teamId,
      },
    });
    expect(createRes.ok(), `Anlegen fehlgeschlagen (${createRes.status()})`).toBe(true);
    const created = (await createRes.json()) as ShiftModel;
    expect(created.teamId).toBe(teamId);

    try {
      const listRes = await adminCtx.get(`/api/shift-models?teamId=${teamId}`);
      expect(listRes.ok()).toBe(true);
      const models = (await listRes.json()) as ShiftModel[];
      expect(models.some((m) => m.id === created.id)).toBe(true);
    } finally {
      await adminCtx.delete(`/api/shift-models/${created.id}`);
    }
  });

  test("POST /shifts für einen Nutzer, der nicht Mitglied des Ziel-Teams ist, liefert 403", async () => {
    test.skip(knownTeamId == null, "Kein erlaubtes Team aus Schichten ableitbar");
    const teamId = knownTeamId!;

    // Erst: ein Nutzer mit fremdem teamId wird bereits beim Anlegen abgelehnt
    // (Write-Scoping greift hier zuerst).
    const unique = Date.now();
    const createUserRes = await adminCtx.post("/api/users", {
      data: {
        name: `E2E Fremd-Schicht ${unique}`,
        email: `e2e.foreignshift.${unique}@dienstplan.test`,
        role: "assistant",
        teamId: FOREIGN_TEAM_ID,
      },
    });
    // teamId fremd -> 403 beim Anlegen (Write-Scoping greift bereits hier).
    expect(createUserRes.status()).toBe(403);

    // Zweiter Versuch: Nutzer ohne teamId anlegen -> landet im Team des Admins,
    // ist also Mitglied. Daher prüfen wir die Cross-Team-Verknüpfung über einen
    // bewusst nicht existierenden userId, der sicher in keinem Team Mitglied ist.
    const NON_MEMBER_USER_ID = 999999;
    const shiftRes = await adminCtx.post("/api/shifts", {
      data: {
        userId: NON_MEMBER_USER_ID,
        startTime: "2026-07-01T08:00:00.000Z",
        endTime: "2026-07-01T16:00:00.000Z",
        type: "active",
        teamId,
      },
    });
    expect(shiftRes.status()).toBe(403);
  });
});
