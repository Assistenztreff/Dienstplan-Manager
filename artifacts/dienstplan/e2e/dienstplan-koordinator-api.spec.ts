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
 * API-Test: Eigener Teamkoordinator-Zugang mit Team-Zuweisung.
 *
 * Ein Dienstleister-Konto legt Verwaltungspersonen (role=koordinator) an,
 * laedt sie zum eigenen Login ein und weist ihnen Teams zu. Die Zuweisung
 * erzeugt team_members-Zeilen mit isTeamleiter=true — damit greift die
 * komplette Teamleiter-Maschinerie (Scoping, Rechtevergabe). Grenzen:
 *
 * - Nur Dienstleister-Konten sehen/verwalten Koordinatoren (privat: 403)
 * - Anlegen ist Premium-gegated (Free: 403)
 * - Fremde Koordinatoren/Teams bleiben unauffindbar (404, kein Orakel)
 * - Koordinatoren tauchen NICHT als Assistenzkraft auf
 * - Entzug der Zuweisung wirkt sofort (frischer DB-Read pro Request)
 */

const RUN = Date.now();
const KOORD_EMAIL = `e2e.koord.person.${RUN}@dienstplan.test`;
const KOORD_PASSWORD = `Pw${RUN}!koord`;

type Entity = { id: number };
type Team = { id: number; name: string };
type KoordinatorDto = {
  id: number;
  name: string;
  email: string;
  hasLogin: boolean;
  teamIds: number[];
};
type MemberDto = { userId: number; role: string; isTeamleiter: boolean; accessLevel: string };
type UserDto = { id: number; role: string };

let owner: FreeAccount; // Premium-Dienstleister (verwaltet den Koordinator)
let fremd: FreeAccount; // zweites Dienstleister-Konto (Cross-Tenant-Gegenprobe)
let privatKonto: FreeAccount; // Privat-Konto (sieht das Feature gar nicht)
let koordCtx: APIRequestContext; // eingeloggter Koordinator

let teamA = 0;
let teamB = 0;
let fremdTeam = 0;
let koordId = 0;
let assistentId = 0;

test.beforeAll(async () => {
  owner = await registerFreeAccount("dienstleister", `koord${RUN}`);
  await setAccountPlan(owner.email, "premium");
  fremd = await registerFreeAccount("dienstleister", `koordfremd${RUN}`);
  await setAccountPlan(fremd.email, "premium");
  privatKonto = await registerFreeAccount("privat", `koordpriv${RUN}`);

  const teamsRes = await owner.ctx.get("/api/teams");
  expect(teamsRes.ok(), "Teams lesen fehlgeschlagen").toBe(true);
  teamA = ((await teamsRes.json()) as Team[])[0]!.id;
  const teamBRes = await owner.ctx.post("/api/teams", { data: { name: `Koord-Team-B ${RUN}` } });
  expect(teamBRes.ok(), "Zweites Team anlegen fehlgeschlagen").toBe(true);
  teamB = ((await teamBRes.json()) as Entity).id;

  const fremdTeamsRes = await fremd.ctx.get("/api/teams");
  expect(fremdTeamsRes.ok()).toBe(true);
  fremdTeam = ((await fremdTeamsRes.json()) as Team[])[0]!.id;

  // Zeiterfassung aktivieren (Konto-Schalter, Standard AUS) — sonst blockt
  // POST /time-tracking mit 403 time_tracking_disabled statt der Authz-Antwort.
  const settingsRes = await owner.ctx.get("/api/allowance-settings");
  expect(settingsRes.ok()).toBe(true);
  const s = (await settingsRes.json()) as {
    nightPercent: number;
    nightStart: string;
    nightEnd: string;
    sundayPercent: number;
    holidayPercent: number;
  };
  const ttRes = await owner.ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: s.nightPercent,
      nightStart: s.nightStart,
      nightEnd: s.nightEnd,
      sundayPercent: s.sundayPercent,
      holidayPercent: s.holidayPercent,
      timeTrackingEnabled: true,
    },
  });
  expect(ttRes.ok(), `Zeiterfassung aktivieren fehlgeschlagen (${ttRes.status()})`).toBe(true);

  // Eine Assistenzkraft in Team A — Gegenprobe fuer Listen und spaeter das
  // Ziel der Rechtevergabe durch den Koordinator.
  const assistentRes = await owner.ctx.post("/api/users", {
    data: {
      name: `E2E KoordAssistenz ${RUN}`,
      email: `e2e.koord.assistenz.${RUN}@dienstplan.test`,
      role: "assistant",
      teamId: teamA,
    },
  });
  expect(assistentRes.ok(), "Assistenzkraft anlegen fehlgeschlagen").toBe(true);
  assistentId = ((await assistentRes.json()) as Entity).id;
});

test.afterAll(async () => {
  await koordCtx?.dispose();
  await deleteFreeAccount(owner);
  await deleteFreeAccount(fremd);
  await deleteFreeAccount(privatKonto);
});

test.describe("Teamkoordinator-Zugang", () => {
  test("Privat-Konten und Free-Plan bleiben ausgeschlossen", async () => {
    const privatList = await privatKonto.ctx.get("/api/koordinatoren");
    expect(privatList.status()).toBe(403);

    // Free-Dienstleister: Feature sichtbar (Liste lesbar), Anlegen Premium-only.
    await setAccountPlan(fremd.email, "free");
    const freePost = await fremd.ctx.post("/api/koordinatoren", {
      data: { name: "Free Koordinator", email: `e2e.koord.free.${RUN}@dienstplan.test` },
    });
    expect(freePost.status()).toBe(403);
    await setAccountPlan(fremd.email, "premium");
  });

  test("Inhaber legt einen Koordinator an (ohne Teams, ohne Login)", async () => {
    const res = await owner.ctx.post("/api/koordinatoren", {
      data: { name: `E2E Koordinator ${RUN}`, email: KOORD_EMAIL },
    });
    expect(res.status(), `Anlegen fehlgeschlagen (${res.status()})`).toBe(201);
    const dto = (await res.json()) as KoordinatorDto;
    koordId = dto.id;
    expect(dto).toMatchObject({ hasLogin: false, teamIds: [] });

    // Doppelte E-Mail: lesbarer Konflikt statt 500.
    const dupRes = await owner.ctx.post("/api/koordinatoren", {
      data: { name: "Doppelt", email: KOORD_EMAIL.toUpperCase() },
    });
    expect(dupRes.status()).toBe(409);

    const listRes = await owner.ctx.get("/api/koordinatoren");
    expect(listRes.ok()).toBe(true);
    const list = (await listRes.json()) as KoordinatorDto[];
    expect(list.some((k) => k.id === koordId)).toBe(true);

    // Fremdes Konto sieht ihn nicht.
    const fremdList = await fremd.ctx.get("/api/koordinatoren");
    expect(fremdList.ok()).toBe(true);
    expect(((await fremdList.json()) as KoordinatorDto[]).some((k) => k.id === koordId)).toBe(
      false,
    );
  });

  test("Team-Zuweisung erzeugt Teamleiter-Mitgliedschaften", async () => {
    const res = await owner.ctx.put(`/api/koordinatoren/${koordId}/teams`, {
      data: { teamIds: [teamA, teamB] },
    });
    expect(res.ok(), `Zuweisung fehlgeschlagen (${res.status()})`).toBe(true);
    const dto = (await res.json()) as KoordinatorDto;
    expect([...dto.teamIds].sort()).toEqual([teamA, teamB].sort());

    const membersRes = await owner.ctx.get(`/api/teams/${teamA}/members`);
    expect(membersRes.ok()).toBe(true);
    const row = ((await membersRes.json()) as MemberDto[]).find((m) => m.userId === koordId);
    expect(row).toMatchObject({ role: "koordinator", isTeamleiter: true });
  });

  test("Koordinator ist keine Assistenzkraft (Listen-Gegenprobe)", async () => {
    const res = await owner.ctx.get(`/api/users?role=assistant&teamId=${teamA}`);
    expect(res.ok()).toBe(true);
    const users = (await res.json()) as UserDto[];
    expect(users.some((u) => u.id === assistentId)).toBe(true);
    expect(users.some((u) => u.id === koordId)).toBe(false);
  });

  test("Koordinator ist nie Personal: Vertraege, Dienste und Mitglieder-Operationen lehnen ab", async () => {
    // Kein Vertrag (wuerde ihn in Stunden-/Lohnauswertungen ziehen).
    const contractRes = await owner.ctx.post("/api/contracts", {
      data: { userId: koordId, teamId: teamA, weeklyHours: 20, vacationDays: 30, startDate: "2026-01-01" },
    });
    expect(contractRes.status(), "Vertrag fuer Koordinator muss abgelehnt werden").toBe(403);

    // Kein Dienst (wuerde ihn im Dienstplan als Pseudo-Assistenzkraft zeigen).
    const shiftRes = await owner.ctx.post("/api/shifts", {
      data: {
        userId: koordId,
        teamId: teamA,
        type: "active",
        startTime: "2026-08-10T08:00:00.000Z",
        endTime: "2026-08-10T12:00:00.000Z",
      },
    });
    expect(shiftRes.status(), "Dienst fuer Koordinator muss abgelehnt werden").toBe(403);

    // Keine Ist-Zeit FUER ihn (er erfasst selbst fuer andere).
    const ttRes = await owner.ctx.post("/api/time-tracking", {
      data: {
        userId: koordId,
        teamId: teamA,
        actualStart: "2026-08-10T08:00:00.000Z",
        actualEnd: "2026-08-10T12:00:00.000Z",
      },
    });
    expect(ttRes.status(), "Ist-Zeit fuer Koordinator muss abgelehnt werden").toBe(403);

    // Generische Mitglieder-Operationen: Zuweisungen laufen NUR ueber
    // PUT /koordinatoren/:id/teams — sonst entstuende eine Zeile ohne
    // isTeamleiter bzw. ein stiller Rechteverlust.
    const addRes = await owner.ctx.post(`/api/teams/${teamA}/members`, {
      data: { userId: koordId },
    });
    expect(addRes.status(), "Generisches Hinzufuegen muss abgelehnt werden").toBe(403);

    const patchRes = await owner.ctx.patch(`/api/teams/${teamA}/members/${koordId}`, {
      data: { isTeamleiter: false },
    });
    expect(patchRes.status(), "Flag-Aenderung muss abgelehnt werden").toBe(403);

    const moveRes = await owner.ctx.post(`/api/teams/${teamA}/members/${koordId}/move`, {
      data: { targetTeamId: teamB },
    });
    expect(moveRes.status(), "Ueberfuehren muss abgelehnt werden").toBe(403);

    const delRes = await owner.ctx.delete(`/api/teams/${teamA}/members/${koordId}`);
    expect(delRes.status(), "Generisches Entfernen muss abgelehnt werden").toBe(403);

    // Kein Rollen-Orakel: Ein FREMDER Koordinator (kein Mitglied des eigenen
    // Teams) antwortet 404 wie jede andere fremde/unbekannte ID — nicht 403.
    const fremdKoordRes = await fremd.ctx.post("/api/koordinatoren", {
      data: { name: `Fremd Koordinator ${RUN}`, email: `e2e.koord.fremdk.${RUN}@dienstplan.test` },
    });
    expect(fremdKoordRes.status()).toBe(201);
    const fremdKoordId = ((await fremdKoordRes.json()) as Entity).id;
    const oracleRes = await owner.ctx.delete(`/api/teams/${teamA}/members/${fremdKoordId}`);
    expect(oracleRes.status(), "Fremder Koordinator darf kein Rollen-Orakel sein").toBe(404);

    // Zuweisung blieb unveraendert (isTeamleiter=true, beide Teams).
    const membersRes = await owner.ctx.get(`/api/teams/${teamA}/members`);
    const row = ((await membersRes.json()) as MemberDto[]).find((m) => m.userId === koordId);
    expect(row).toMatchObject({ role: "koordinator", isTeamleiter: true });
  });

  test("Fremde Koordinatoren und fremde Teams bleiben unauffindbar", async () => {
    // Fremdes Konto versucht, den Koordinator umzuhaengen bzw. einzuladen.
    const fremdPut = await fremd.ctx.put(`/api/koordinatoren/${koordId}/teams`, {
      data: { teamIds: [fremdTeam] },
    });
    expect(fremdPut.status()).toBe(404);
    const fremdInvite = await fremd.ctx.post(`/api/users/${koordId}/invite`, {});
    expect(fremdInvite.status()).toBe(404);

    // Inhaber versucht, ein fremdes Team zuzuweisen.
    const ownPut = await owner.ctx.put(`/api/koordinatoren/${koordId}/teams`, {
      data: { teamIds: [teamA, fremdTeam] },
    });
    expect(ownPut.status()).toBe(404);
  });

  test("Einladung, Login und Teamleiter-Rechte in zugewiesenen Teams", async () => {
    const inviteRes = await owner.ctx.post(`/api/users/${koordId}/invite`, {});
    expect(inviteRes.ok(), `Einladung fehlgeschlagen (${inviteRes.status()})`).toBe(true);
    const { token } = (await inviteRes.json()) as { token: string };

    koordCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const pwRes = await koordCtx.post("/api/auth/set-password", {
      data: { token, password: KOORD_PASSWORD },
    });
    expect(pwRes.ok(), "Passwort setzen fehlgeschlagen").toBe(true);
    const loginRes = await koordCtx.post("/api/auth/login", {
      data: { email: KOORD_EMAIL, password: KOORD_PASSWORD },
    });
    expect(loginRes.ok(), "Login als Koordinator fehlgeschlagen").toBe(true);

    const meRes = await koordCtx.get("/api/auth/me");
    expect(meRes.ok()).toBe(true);
    expect((await meRes.json()) as { role: string; isTeamleiter?: boolean }).toMatchObject({
      role: "koordinator",
      isTeamleiter: true,
    });

    // hasLogin kippt nach dem Passwort-Setzen auf true.
    const listRes = await owner.ctx.get("/api/koordinatoren");
    const dto = ((await listRes.json()) as KoordinatorDto[]).find((k) => k.id === koordId);
    expect(dto?.hasLogin).toBe(true);

    // Sieht seine zugewiesenen Teams …
    const teamsRes = await koordCtx.get("/api/teams");
    expect(teamsRes.ok()).toBe(true);
    const teamIds = ((await teamsRes.json()) as Team[]).map((t) => t.id);
    expect(teamIds).toContain(teamA);
    expect(teamIds).toContain(teamB);

    // … und vergibt dort als Teamleiter Zugriffsstufen (Feature "Teamleiter
    // duerfen Zugriffsrechte vergeben" greift ohne Sonderpfad).
    const stufeRes = await koordCtx.patch(`/api/teams/${teamA}/members/${assistentId}`, {
      data: { accessLevel: "basis" },
    });
    expect(stufeRes.ok(), `Stufenvergabe fehlgeschlagen (${stufeRes.status()})`).toBe(true);

    // Selbstverwaltung bleibt tabu: Koordinatoren verwalten keine Koordinatoren.
    const selfList = await koordCtx.get("/api/koordinatoren");
    expect(selfList.status()).toBe(403);
  });

  test("Zeiterfassung: Koordinator erfasst nur innerhalb zugewiesener Teams", async () => {
    // Koordinatoren sind Verwaltungspersonen: Sie dürfen (wie der Inhaber)
    // Ist-Zeiten für Team-Mitglieder erfassen — aber strikt team-gescoped.
    const okRes = await koordCtx.post("/api/time-tracking", {
      data: {
        userId: assistentId,
        teamId: teamA,
        actualStart: "2026-08-03T08:00:00.000Z",
        actualEnd: "2026-08-03T12:00:00.000Z",
      },
    });
    expect(okRes.status(), `Erfassen im eigenen Team fehlgeschlagen (${okRes.status()})`).toBe(
      201,
    );

    // Fremdes Team (anderes Konto): kein Zugriff.
    const fremdRes = await koordCtx.post("/api/time-tracking", {
      data: {
        userId: assistentId,
        teamId: fremdTeam,
        actualStart: "2026-08-04T08:00:00.000Z",
        actualEnd: "2026-08-04T12:00:00.000Z",
      },
    });
    expect(fremdRes.status()).toBe(403);

    // Nutzer, der NICHT Mitglied des Ziel-Teams ist (der Koordinator selbst
    // ist in Team B Mitglied, der Assistent nicht): abgelehnt.
    const nichtMitgliedRes = await koordCtx.post("/api/time-tracking", {
      data: {
        userId: assistentId,
        teamId: teamB,
        actualStart: "2026-08-05T08:00:00.000Z",
        actualEnd: "2026-08-05T12:00:00.000Z",
      },
    });
    expect(nichtMitgliedRes.status()).toBe(403);
  });

  test("Entzug der Team-Zuweisung wirkt sofort", async () => {
    const res = await owner.ctx.put(`/api/koordinatoren/${koordId}/teams`, {
      data: { teamIds: [teamB] },
    });
    expect(res.ok(), `Entzug fehlgeschlagen (${res.status()})`).toBe(true);
    expect(((await res.json()) as KoordinatorDto).teamIds).toEqual([teamB]);

    // Kein neuer Login noetig: Rechte werden pro Request frisch gelesen.
    const stufeRes = await koordCtx.patch(`/api/teams/${teamA}/members/${assistentId}`, {
      data: { accessLevel: "keine" },
    });
    expect(stufeRes.status()).toBe(404);

    const teamsRes = await koordCtx.get("/api/teams");
    expect(teamsRes.ok()).toBe(true);
    const teamIds = ((await teamsRes.json()) as Team[]).map((t) => t.id);
    expect(teamIds).not.toContain(teamA);
    expect(teamIds).toContain(teamB);

    // Vollstaendiger Entzug: Koordinator bleibt sichtbar (Konto-Verknuepfung),
    // hat aber keine Teams mehr.
    const leerRes = await owner.ctx.put(`/api/koordinatoren/${koordId}/teams`, {
      data: { teamIds: [] },
    });
    expect(leerRes.ok()).toBe(true);
    expect(((await leerRes.json()) as KoordinatorDto).teamIds).toEqual([]);
    const listRes = await owner.ctx.get("/api/koordinatoren");
    expect(((await listRes.json()) as KoordinatorDto[]).some((k) => k.id === koordId)).toBe(true);
  });
});
