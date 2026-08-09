import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  BASE_URL,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: Teamleiter vergeben Zugriffsstufen im eigenen Team.
 *
 * Der Konto-Inhaber eines Dienstleister-Kontos setzt Mitarbeitende als
 * Teamleiter ein; diese duerfen dann innerhalb IHRES Teams anderen Mitgliedern
 * die Zugriffsstufe (keine/basis/stufe1/stufe2) setzen. Alles andere bleibt
 * Inhaber-only. Diese Grenzen sind sicherheitsrelevant:
 *
 * - Teamleiter setzt Stufe                          -> erlaubt
 * - Teamleiter setzt Teamleiter-/Lohndaten-Flag     -> 403 (auch im Teil-Body)
 * - Teamleiter aendert Rechte des Konto-Inhabers    -> 403
 * - Stufe 2 OHNE Teamleiter-Status vergibt Stufen   -> 404 (kein Orakel)
 * - Fremdes Team                                    -> 404 (kein Orakel)
 * - Entzug des Teamleiter-Status wirkt sofort (frischer DB-Read pro Request)
 */

const RUN = Date.now();
const LEITER_EMAIL = `e2e.tlrechte.leiter.${RUN}@dienstplan.test`;
const LEITER_PASSWORD = `Pw${RUN}!leiter`;
const KOLLEGE_EMAIL = `e2e.tlrechte.kollege.${RUN}@dienstplan.test`;
const KOLLEGE_PASSWORD = `Pw${RUN}!kollege`;

type Entity = { id: number };
type Team = { id: number };
type MemberDto = { userId: number; isTeamleiter: boolean; accessLevel: string };

let owner: FreeAccount; // Dienstleister-Konto (Eigentuemer beider Teams)
let leiterCtx: APIRequestContext; // Teamleiter in Team A
let kollegeCtx: APIRequestContext; // Stufe-2-Mitglied OHNE Teamleiter-Status

let teamA = 0;
let teamB = 0;
let leiterId = 0;
let kollegeId = 0;

/** Login eines angelegten Nutzers ueber den Einladungs-Token (Premium-Feature). */
async function inviteLogin(
  userId: number,
  email: string,
  password: string,
): Promise<APIRequestContext> {
  const inviteRes = await owner.ctx.post(`/api/users/${userId}/invite`, {});
  expect(inviteRes.ok(), `Einladung fehlgeschlagen (${inviteRes.status()})`).toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };

  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const pwRes = await ctx.post("/api/auth/set-password", { data: { token, password } });
  expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);
  const loginRes = await ctx.post("/api/auth/login", { data: { email, password } });
  expect(loginRes.ok(), `Login als ${email} fehlgeschlagen`).toBe(true);
  return ctx;
}

test.beforeAll(async () => {
  owner = await registerFreeAccount("dienstleister", `tlrechte${RUN}`);
  // Premium: zweites Team (Free = 1) und Einladungs-Logins sind Premium-Features.
  await setAccountPlan(owner.email, "premium");

  const teamsRes = await owner.ctx.get("/api/teams");
  expect(teamsRes.ok(), "Teams lesen fehlgeschlagen").toBe(true);
  teamA = ((await teamsRes.json()) as Team[])[0]!.id;

  const teamBRes = await owner.ctx.post("/api/teams", { data: { name: `Fremd-Team ${RUN}` } });
  expect(teamBRes.ok(), "Zweites Team anlegen fehlgeschlagen").toBe(true);
  teamB = ((await teamBRes.json()) as Entity).id;

  const leiterRes = await owner.ctx.post("/api/users", {
    data: { name: `E2E Leiter ${RUN}`, email: LEITER_EMAIL, role: "assistant", teamId: teamA },
  });
  expect(leiterRes.ok(), "Leiter anlegen fehlgeschlagen").toBe(true);
  leiterId = ((await leiterRes.json()) as Entity).id;

  const kollegeRes = await owner.ctx.post("/api/users", {
    data: { name: `E2E Kollege ${RUN}`, email: KOLLEGE_EMAIL, role: "assistant", teamId: teamA },
  });
  expect(kollegeRes.ok(), "Kollege anlegen fehlgeschlagen").toBe(true);
  kollegeId = ((await kollegeRes.json()) as Entity).id;

  // Inhaber setzt den Leiter als Teamleiter ein und gibt dem Kollegen Stufe 2 —
  // der Kollege ist damit das Gegenbeispiel (verwalten ja, Rechtevergabe nein).
  const tlRes = await owner.ctx.patch(`/api/teams/${teamA}/members/${leiterId}`, {
    data: { isTeamleiter: true },
  });
  expect(tlRes.ok(), `Teamleiter einsetzen fehlgeschlagen (${tlRes.status()})`).toBe(true);
  const s2Res = await owner.ctx.patch(`/api/teams/${teamA}/members/${kollegeId}`, {
    data: { accessLevel: "stufe2" },
  });
  expect(s2Res.ok(), `Stufe 2 setzen fehlgeschlagen (${s2Res.status()})`).toBe(true);

  leiterCtx = await inviteLogin(leiterId, LEITER_EMAIL, LEITER_PASSWORD);
  kollegeCtx = await inviteLogin(kollegeId, KOLLEGE_EMAIL, KOLLEGE_PASSWORD);
});

test.afterAll(async () => {
  await leiterCtx?.dispose();
  await kollegeCtx?.dispose();
  await deleteFreeAccount(owner);
});

test.describe("Teamleiter-Rechtevergabe", () => {
  test("Teamleiter setzt die Zugriffsstufe eines Mitglieds im eigenen Team", async () => {
    const res = await leiterCtx.patch(`/api/teams/${teamA}/members/${kollegeId}`, {
      data: { accessLevel: "basis" },
    });
    expect(res.ok(), `Stufe setzen fehlgeschlagen (${res.status()})`).toBe(true);
    expect((await res.json()) as MemberDto).toMatchObject({ accessLevel: "basis" });

    // Zuruecksetzen auf Stufe 2: Der Kollege bleibt Gegenbeispiel fuer den
    // Stufe-2-ohne-Teamleiter-Fall weiter unten.
    const reset = await leiterCtx.patch(`/api/teams/${teamA}/members/${kollegeId}`, {
      data: { accessLevel: "stufe2" },
    });
    expect(reset.ok(), `Zuruecksetzen fehlgeschlagen (${reset.status()})`).toBe(true);
  });

  test("Teamleiter darf Teamleiter- und Lohndaten-Flags nicht aendern", async () => {
    const flagRes = await leiterCtx.patch(`/api/teams/${teamA}/members/${kollegeId}`, {
      data: { isTeamleiter: true },
    });
    expect(flagRes.status()).toBe(403);

    const payrollRes = await leiterCtx.patch(`/api/teams/${teamA}/members/${kollegeId}`, {
      data: { canViewPayroll: true },
    });
    expect(payrollRes.status()).toBe(403);

    // Auch im Teil-Body mit erlaubtem Feld: komplette Ablehnung, keine
    // stille Teil-Speicherung.
    const mixedRes = await leiterCtx.patch(`/api/teams/${teamA}/members/${kollegeId}`, {
      data: { accessLevel: "basis", isTeamleiter: true },
    });
    expect(mixedRes.status()).toBe(403);

    // Gegenprobe: Es wurde wirklich nichts gespeichert.
    const membersRes = await owner.ctx.get(`/api/teams/${teamA}/members`);
    expect(membersRes.ok()).toBe(true);
    const kollege = ((await membersRes.json()) as MemberDto[]).find(
      (m) => m.userId === kollegeId,
    );
    expect(kollege).toMatchObject({ isTeamleiter: false, accessLevel: "stufe2" });
  });

  test("Teamleiter kann die Rechte des Konto-Inhabers nicht aendern", async () => {
    const res = await leiterCtx.patch(`/api/teams/${teamA}/members/${owner.id}`, {
      data: { accessLevel: "keine" },
    });
    expect(res.status()).toBe(403);
  });

  test("Stufe 2 ohne Teamleiter-Status erlaubt keine Rechtevergabe", async () => {
    const res = await kollegeCtx.patch(`/api/teams/${teamA}/members/${leiterId}`, {
      data: { accessLevel: "keine" },
    });
    expect(res.status()).toBe(404);
  });

  test("Fremdes Team bleibt unauffindbar (kein Daten-Orakel)", async () => {
    // Team B gehoert demselben Konto, der Leiter ist dort aber kein Teamleiter.
    const res = await leiterCtx.patch(`/api/teams/${teamB}/members/${kollegeId}`, {
      data: { accessLevel: "basis" },
    });
    expect(res.status()).toBe(404);
  });

  test("Eigene Stufe aendern sperrt den Teamleiter nicht aus", async () => {
    // Erlaubt, aber KEINE Eskalation und KEIN Selbst-Aussperren: Die eigene
    // Zeile ist ein normales Mitglied (nicht der Inhaber), und die effektive
    // Berechtigung haengt am Teamleiter-Flag, nicht an der Stufe.
    const res = await leiterCtx.patch(`/api/teams/${teamA}/members/${leiterId}`, {
      data: { accessLevel: "keine" },
    });
    expect(res.ok(), `Eigene Stufe setzen fehlgeschlagen (${res.status()})`).toBe(true);

    // Trotz Stufe "keine" bleibt der Teamleiter voll handlungsfaehig.
    const membersRes = await leiterCtx.get(`/api/teams/${teamA}/members`);
    expect(membersRes.ok(), `Mitglieder lesen fehlgeschlagen (${membersRes.status()})`).toBe(true);
    const wieder = await leiterCtx.patch(`/api/teams/${teamA}/members/${kollegeId}`, {
      data: { accessLevel: "stufe2" },
    });
    expect(wieder.ok(), `Stufe setzen fehlgeschlagen (${wieder.status()})`).toBe(true);
  });

  test("Entzug des Teamleiter-Status wirkt sofort", async () => {
    const revoke = await owner.ctx.patch(`/api/teams/${teamA}/members/${leiterId}`, {
      data: { isTeamleiter: false },
    });
    expect(revoke.ok(), `Entzug fehlgeschlagen (${revoke.status()})`).toBe(true);

    // Kein neuer Login: Der Teamleiter-Status wird pro Request frisch gelesen.
    const res = await leiterCtx.patch(`/api/teams/${teamA}/members/${kollegeId}`, {
      data: { accessLevel: "basis" },
    });
    expect(res.status()).toBe(404);
  });
});
