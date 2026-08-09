import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  enableTimeTracking,
  deleteFreeAccount,
  BASE_URL,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Die gestufte Team-Freischaltung (Task #734).
 *
 * Ein Assistenznehmer beim Dienstleister bekommt Rechte NICHT über die globale
 * Nutzerrolle, sondern pro Mitgliedschaft (`team_members.access_level`):
 *
 *   keine  → nur eigene Daten
 *   basis  → Team lesen (Dienstplan, Abwesenheiten)
 *   stufe1 → zusätzlich planen / Assistenzkräfte pflegen
 *   stufe2 → zusätzlich Team-Verwaltung und Zeiterfassung
 *
 * Diese Zusagen sind sicherheitsrelevant und dürfen nicht still verrutschen:
 * Jede Lockerung (falsche Middleware, vergessene Capability-Prüfung) würde
 * einer Assistenzkraft fremde Personendaten oder Schreibrechte geben.
 *
 * Geprüft wird deshalb an EINEM Testsubjekt die vollständige Leiter — inklusive
 * der beiden Richtungen, die erfahrungsgemäß brechen:
 * - Rechteentzug wirkt sofort (die Stufe wird pro Request frisch gelesen),
 * - eine Freischaltung in Team A gibt NIE Zugriff auf Team B.
 *
 * Zusätzlich die Lohndaten-Sperre: `canViewPayroll` ist an den Teamleiter-
 * Status gebunden und fällt beim Entzug automatisch mit.
 */

const RUN = Date.now();
const HELPER_EMAIL = `e2e.stufen.helfer.${RUN}@dienstplan.test`;
const HELPER_PASSWORD = `Pw${RUN}!stufen`;

type Entity = { id: number };
type Team = { id: number; name: string };
type AccessLevel = "keine" | "basis" | "stufe1" | "stufe2";

let owner: FreeAccount; // Dienstleister-Konto (Eigentümer beider Teams)
let helferCtx: APIRequestContext; // das Testsubjekt (reine Assistenzkraft)

let teamA = 0;
let teamB = 0;
let helferId = 0;
let kollegeId = 0;
let timeEntryId = 0;

/** Setzt die Freischaltung des Testsubjekts in einem Team (als Konto-Admin). */
async function setAccess(teamId: number, level: AccessLevel): Promise<void> {
  const res = await owner.ctx.patch(`/api/teams/${teamId}/members/${helferId}`, {
    data: { accessLevel: level },
  });
  expect(res.ok(), `Stufe ${level} setzen fehlgeschlagen (${res.status()})`).toBe(true);
}

/** Ein Planungs-Schreibversuch des Testsubjekts: legt einen Dienst für den Kollegen an. */
async function tryPlanShift(teamId: number, day: string): Promise<number> {
  const res = await helferCtx.post("/api/shifts", {
    data: {
      userId: kollegeId,
      teamId,
      startTime: `${day}T08:00:00.000Z`,
      endTime: `${day}T16:00:00.000Z`,
      type: "active",
    },
  });
  const status = res.status();
  if (res.ok()) {
    // Aufräumen: Der Dienst darf den nächsten Stufen-Schritt nicht blockieren
    // (Überschneidungs-409 würde die Aussage des Tests verfälschen).
    const id = ((await res.json()) as Entity).id;
    await owner.ctx.delete(`/api/shifts/${id}`);
  }
  return status;
}

test.beforeAll(async () => {
  owner = await registerFreeAccount("dienstleister", `stufen${RUN}`);
  // Premium: Free erlaubt nur EIN Team, der Test braucht ein zweites zum
  // Nachweis der Team-Grenze, und die Zeiterfassung ist ein Premium-Feature.
  await setAccountPlan(owner.email, "premium");
  await enableTimeTracking(owner.ctx);

  const teamsRes = await owner.ctx.get("/api/teams");
  expect(teamsRes.ok(), "Teams lesen fehlgeschlagen").toBe(true);
  const teams = (await teamsRes.json()) as Team[];
  teamA = teams[0]!.id; // Standard-Team aus der Registrierung

  const teamBRes = await owner.ctx.post("/api/teams", { data: { name: `Fremd-Team ${RUN}` } });
  expect(teamBRes.ok(), "Zweites Team anlegen fehlgeschlagen").toBe(true);
  teamB = ((await teamBRes.json()) as Entity).id;

  // Testsubjekt und ein Kollege, beide in Team A.
  const helferRes = await owner.ctx.post("/api/users", {
    data: { name: `E2E Helfer ${RUN}`, email: HELPER_EMAIL, role: "assistant", teamId: teamA },
  });
  expect(helferRes.ok(), "Helfer anlegen fehlgeschlagen").toBe(true);
  helferId = ((await helferRes.json()) as Entity).id;

  const kollegeRes = await owner.ctx.post("/api/users", {
    data: {
      name: `E2E Kollege ${RUN}`,
      email: `e2e.stufen.kollege.${RUN}@dienstplan.test`,
      role: "assistant",
      teamId: teamA,
    },
  });
  expect(kollegeRes.ok(), "Kollege anlegen fehlgeschlagen").toBe(true);
  kollegeId = ((await kollegeRes.json()) as Entity).id;

  // Ein Ist-Zeit-Eintrag des Kollegen — Prüfstein für die Zeiterfassung (Stufe 2).
  const shiftRes = await owner.ctx.post("/api/shifts", {
    data: {
      userId: kollegeId,
      teamId: teamA,
      startTime: `2026-11-02T08:00:00.000Z`,
      endTime: `2026-11-02T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftRes.ok(), "Dienst anlegen fehlgeschlagen").toBe(true);
  const shiftId = ((await shiftRes.json()) as Entity).id;

  const entryRes = await owner.ctx.post("/api/time-tracking", {
    data: {
      userId: kollegeId,
      shiftId,
      teamId: teamA,
      actualStart: `2026-11-02T08:05:00.000Z`,
      actualEnd: `2026-11-02T16:10:00.000Z`,
    },
  });
  expect(entryRes.ok(), `Zeiteintrag anlegen fehlgeschlagen (${entryRes.status()})`).toBe(true);
  timeEntryId = ((await entryRes.json()) as Entity).id;

  // Login des Testsubjekts über den Einladungs-Token.
  const inviteRes = await owner.ctx.post(`/api/users/${helferId}/invite`, {});
  expect(inviteRes.ok(), "Einladung fehlgeschlagen").toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };

  helferCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const pwRes = await helferCtx.post("/api/auth/set-password", {
    data: { token, password: HELPER_PASSWORD },
  });
  expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);
  const loginRes = await helferCtx.post("/api/auth/login", {
    data: { email: HELPER_EMAIL, password: HELPER_PASSWORD },
  });
  expect(loginRes.ok(), "Helfer-Login fehlgeschlagen").toBe(true);
});

test.afterAll(async () => {
  await helferCtx?.dispose();
  // deleteFreeAccount räumt den kompletten Datenbaum des Kontos per SQL ab
  // (die API-Löschung scheitert an FKs der Team-Tabellen).
  await deleteFreeAccount(owner);
});

test.describe("Gestufte Team-Freischaltung", () => {
  test("ohne Freischaltung: kein Team, keine Mitgliederliste, kein Planen", async () => {
    await setAccess(teamA, "keine");

    const teamsRes = await helferCtx.get("/api/teams");
    expect(teamsRes.ok()).toBe(true);
    expect((await teamsRes.json()) as Team[]).toEqual([]);

    const membersRes = await helferCtx.get(`/api/teams/${teamA}/members`);
    expect([401, 403, 404]).toContain(membersRes.status());

    expect([401, 403, 404]).toContain(await tryPlanShift(teamA, "2026-11-10"));
  });

  test("basis: Team lesen ja, planen nein", async () => {
    await setAccess(teamA, "basis");

    const teamsRes = await helferCtx.get("/api/teams");
    expect(teamsRes.ok()).toBe(true);
    expect(((await teamsRes.json()) as Team[]).map((t) => t.id)).toEqual([teamA]);

    // Mitgliederliste ist Teil der Team-Übersicht und ab Basis lesbar.
    const membersRes = await helferCtx.get(`/api/teams/${teamA}/members`);
    expect(membersRes.ok(), `Mitglieder lesen fehlgeschlagen (${membersRes.status()})`).toBe(true);
    const memberIds = ((await membersRes.json()) as { userId: number }[]).map((m) => m.userId);
    expect(memberIds).toContain(kollegeId);

    // Lesen des Teamplans ist erlaubt …
    const shiftsRes = await helferCtx.get(`/api/shifts?teamId=${teamA}`);
    expect(shiftsRes.ok(), `Dienste lesen fehlgeschlagen (${shiftsRes.status()})`).toBe(true);

    // … Planen für andere jedoch nicht.
    expect([401, 403, 404]).toContain(await tryPlanShift(teamA, "2026-11-11"));
  });

  test("stufe1: planen ja, Zeiterfassung bestaetigen nein", async () => {
    await setAccess(teamA, "stufe1");

    expect(await tryPlanShift(teamA, "2026-11-12")).toBe(201);

    const confirmRes = await helferCtx.patch(`/api/time-tracking/${timeEntryId}/confirm`, {
      data: { status: "confirmed" },
    });
    expect([401, 403, 404]).toContain(confirmRes.status());
  });

  test("stufe2: Zeiterfassung bestaetigen ja", async () => {
    await setAccess(teamA, "stufe2");

    const confirmRes = await helferCtx.patch(`/api/time-tracking/${timeEntryId}/confirm`, {
      data: { status: "confirmed" },
    });
    expect(confirmRes.ok(), `Bestaetigen fehlgeschlagen (${confirmRes.status()})`).toBe(true);
    expect((await confirmRes.json()) as { status: string }).toMatchObject({
      status: "confirmed",
    });
  });

  test("Freischaltung endet an der Teamgrenze", async () => {
    await setAccess(teamA, "stufe2");

    // Team B gehört demselben Konto, das Testsubjekt ist dort aber kein Mitglied.
    const teamsRes = await helferCtx.get("/api/teams");
    expect(((await teamsRes.json()) as Team[]).map((t) => t.id)).toEqual([teamA]);

    const membersRes = await helferCtx.get(`/api/teams/${teamB}/members`);
    expect([401, 403, 404]).toContain(membersRes.status());

    expect([401, 403, 404]).toContain(await tryPlanShift(teamB, "2026-11-13"));
  });

  test("Rechteentzug wirkt sofort", async () => {
    await setAccess(teamA, "stufe1");
    expect(await tryPlanShift(teamA, "2026-11-14")).toBe(201);

    // Kein neuer Login: Die Stufe wird pro Request frisch aus der DB gelesen.
    await setAccess(teamA, "keine");
    expect([401, 403, 404]).toContain(await tryPlanShift(teamA, "2026-11-15"));
  });

  test("Stufen geben keinen Lohndaten-Zugriff frei", async () => {
    await setAccess(teamA, "stufe2");

    // Ohne Teamleiter-Status ist die Freigabe unzulässig — 403 statt stiller Speicherung.
    const abgelehnt = await owner.ctx.patch(`/api/teams/${teamA}/members/${helferId}`, {
      data: { canViewPayroll: true },
    });
    expect(abgelehnt.status()).toBe(403);

    // Als Teamleiter im Dienstleister-Konto ist sie erlaubt …
    const erlaubt = await owner.ctx.patch(`/api/teams/${teamA}/members/${helferId}`, {
      data: { isTeamleiter: true, canViewPayroll: true },
    });
    expect(erlaubt.ok(), `Freigabe fehlgeschlagen (${erlaubt.status()})`).toBe(true);
    expect((await erlaubt.json()) as { canViewPayroll: boolean }).toMatchObject({
      canViewPayroll: true,
    });

    // … und fällt beim Entzug des Teamleiterstatus automatisch mit.
    const entzogen = await owner.ctx.patch(`/api/teams/${teamA}/members/${helferId}`, {
      data: { isTeamleiter: false },
    });
    expect(entzogen.ok(), `Entzug fehlgeschlagen (${entzogen.status()})`).toBe(true);
    expect((await entzogen.json()) as { canViewPayroll: boolean }).toMatchObject({
      canViewPayroll: false,
    });
  });
});
