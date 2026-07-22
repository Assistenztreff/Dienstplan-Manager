import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test für den Team-Dienst (Teamsitzung) mit Stunden-Gutschrift:
 * - Konto-Schalter AUS (Default): POST /shifts type=team -> 400 team_meeting_disabled.
 * - Schalter EIN: Team-Eintrag wird angelegt (201) und serverseitig auf FIX
 *   sowie ganztaegig gezwungen.
 * - Zweiter Team-Eintrag am selben Tag im selben Team -> 409
 *   team_meeting_duplicate mit existingShiftId.
 * - GET /dashboard/hours-balance schreibt ALLEN Mitgliedern des Teams die
 *   konfigurierten Stunden gut (teamsitzungStunden), bilanz-neutral
 *   (plannedHours und totalFulfilledHours steigen gleichermassen).
 * - Team-Scoping: Mitglieder eines ANDEREN Teams desselben Kontos erhalten
 *   KEINE Gutschrift.
 */

const YEAR = 2026;
const MONTH = 6;
const DAY = `${YEAR}-0${MONTH}-10`;
const START_ISO = `${DAY}T00:00:00.000Z`;
const END_ISO = `${DAY}T23:59:59.000Z`;
const TEAM_MEETING_HOURS = 2;

type Team = { id: number; name: string };
type CreatedUser = { id: number };
type Shift = { id: number; type: string; planningStatus: string };
type BalanceRow = {
  userId: number;
  teamsitzungStunden: number;
  teamsitzungEuro: number;
  plannedHours: number;
  totalFulfilledHours: number;
};

let account: FreeAccount | undefined;
let ctx: APIRequestContext;
let teamAId = 0;
let teamBId = 0;
let assistantA1 = 0;
let assistantA2 = 0;
let assistantB1 = 0;

async function createAssistant(
  teamId: number,
  suffix: string,
): Promise<number> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E Teamsitzung ${suffix}`,
      email: `e2e.teamsitzung.${suffix}.${Date.now()}@dienstplan.test`,
      role: "assistant",
      teamId,
    },
  });
  expect(res.ok(), `Assistent anlegen fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as CreatedUser).id;
}

async function setTeamMeeting(enabled: boolean, hours: number): Promise<void> {
  const getRes = await ctx.get("/api/allowance-settings");
  expect(getRes.ok()).toBe(true);
  const s = (await getRes.json()) as {
    nightPercent: number;
    nightStart: string;
    nightEnd: string;
    sundayPercent: number;
    holidayPercent: number;
  };
  const putRes = await ctx.put("/api/allowance-settings", {
    data: {
      nightPercent: s.nightPercent,
      nightStart: s.nightStart,
      nightEnd: s.nightEnd,
      sundayPercent: s.sundayPercent,
      holidayPercent: s.holidayPercent,
      teamMeetingEnabled: enabled,
      teamMeetingHours: hours,
    },
  });
  expect(
    putRes.ok(),
    `Teamsitzung-Einstellung speichern fehlgeschlagen (${putRes.status()})`,
  ).toBe(true);
}

function postTeamShift(userId: number, teamId: number) {
  return ctx.post("/api/shifts", {
    data: {
      userId,
      teamId,
      type: "team",
      startTime: START_ISO,
      endTime: END_ISO,
    },
  });
}

async function balanceRows(teamId: number): Promise<BalanceRow[]> {
  const res = await ctx.get(
    `/api/dashboard/hours-balance?month=${MONTH}&year=${YEAR}&teamId=${teamId}`,
  );
  expect(res.ok(), `hours-balance fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as BalanceRow[];
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // Dienstleister-Konto: GET /teams ist zugaenglich und mehrere Teams erlaubt.
  account = await registerFreeAccount("dienstleister", "teamsitzung");
  ctx = account.ctx;
  // Premium: hours-balance (advancedAnalytics) und zweites Team (maxTeams).
  await setAccountPlan(account.email, "premium");

  const teamsRes = await ctx.get("/api/teams");
  expect(teamsRes.ok()).toBe(true);
  const teams = (await teamsRes.json()) as Team[];
  expect(teams.length).toBeGreaterThan(0);
  teamAId = teams[0]!.id;

  const teamBRes = await ctx.post("/api/teams", {
    data: { name: "E2E Teamsitzung Zweitteam" },
  });
  expect(teamBRes.ok(), `Zweitteam anlegen fehlgeschlagen (${teamBRes.status()})`).toBe(true);
  teamBId = ((await teamBRes.json()) as Team).id;

  assistantA1 = await createAssistant(teamAId, "a1");
  assistantA2 = await createAssistant(teamAId, "a2");
  assistantB1 = await createAssistant(teamBId, "b1");
});

test.afterAll(async () => {
  await deleteFreeAccount(account);
});

test.describe("Teamsitzung (Team-Dienst) — API", () => {
  test("Schalter AUS: POST type=team wird mit 400 team_meeting_disabled abgelehnt", async () => {
    const res = await postTeamShift(assistantA1, teamAId);
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("team_meeting_disabled");
  });

  test("Schalter EIN: Team-Eintrag wird angelegt, FIX erzwungen, Duplikat am selben Tag 409", async () => {
    await setTeamMeeting(true, TEAM_MEETING_HOURS);

    const createRes = await postTeamShift(assistantA1, teamAId);
    expect(createRes.status(), "Team-Eintrag muss angelegt werden").toBe(201);
    const shift = (await createRes.json()) as Shift;
    expect(shift.type).toBe("team");
    expect(shift.planningStatus, "Team-Eintrag muss serverseitig FIX sein").toBe("FIX");

    // Zweiter Eintrag am selben Tag im selben Team — auch mit anderer
    // Assistenzkraft — wird abgelehnt (ein Eintrag gilt fuer das ganze Team).
    const dupRes = await postTeamShift(assistantA2, teamAId);
    expect(dupRes.status()).toBe(409);
    const dup = (await dupRes.json()) as { code: string; existingShiftId: number };
    expect(dup.code).toBe("team_meeting_duplicate");
    expect(dup.existingShiftId).toBe(shift.id);
  });

  test("Ganztaegig erzwungen: beliebiges Zeitfenster wird serverseitig auf den vollen Tag normalisiert", async () => {
    // Anderer Tag, damit kein 409 mit dem bestehenden Eintrag entsteht.
    const otherDay = `${YEAR}-0${MONTH}-11`;
    const res = await ctx.post("/api/shifts", {
      data: {
        userId: assistantA1,
        teamId: teamAId,
        type: "team",
        startTime: `${otherDay}T09:15:00.000Z`,
        endTime: `${otherDay}T10:45:00.000Z`,
      },
    });
    expect(res.status(), "Team-Eintrag muss angelegt werden").toBe(201);
    const shift = (await res.json()) as Shift & { startTime: string; endTime: string };
    expect(new Date(shift.startTime).toISOString()).toBe(`${otherDay}T00:00:00.000Z`);
    expect(new Date(shift.endTime).toISOString()).toBe(`${otherDay}T23:59:59.000Z`);

    // PATCH mit engem Zeitfenster wird ebenfalls normalisiert.
    const patchRes = await ctx.patch(`/api/shifts/${shift.id}`, {
      data: {
        startTime: `${otherDay}T13:00:00.000Z`,
        endTime: `${otherDay}T14:00:00.000Z`,
      },
    });
    expect(patchRes.ok(), `PATCH fehlgeschlagen (${patchRes.status()})`).toBe(true);
    const patched = (await patchRes.json()) as { startTime: string; endTime: string };
    expect(new Date(patched.startTime).toISOString()).toBe(`${otherDay}T00:00:00.000Z`);
    expect(new Date(patched.endTime).toISOString()).toBe(`${otherDay}T23:59:59.000Z`);

    // Bypass-Versuch: tagesuebergreifendes Fenster mit exakt 23:59:59 Dauer
    // (09:00Z bis 08:59:59Z am Folgetag) wird ebenfalls auf den UTC-Kalendertag
    // des Starts normalisiert — nicht nur die Dauer, die FORM zaehlt.
    const patch2 = await ctx.patch(`/api/shifts/${shift.id}`, {
      data: {
        startTime: `${otherDay}T09:00:00.000Z`,
        endTime: `${YEAR}-0${MONTH}-12T08:59:59.000Z`,
      },
    });
    expect(patch2.ok(), `PATCH fehlgeschlagen (${patch2.status()})`).toBe(true);
    const patched2 = (await patch2.json()) as { startTime: string; endTime: string };
    expect(new Date(patched2.startTime).toISOString()).toBe(`${otherDay}T00:00:00.000Z`);
    expect(new Date(patched2.endTime).toISOString()).toBe(`${otherDay}T23:59:59.000Z`);

    // Aufraeumen, damit die Gutschrift-Tests nur den einen Team-Tag sehen.
    const delRes = await ctx.delete(`/api/shifts/${shift.id}`);
    expect(delRes.ok()).toBe(true);
  });

  test("Gutschrift: EIN Eintrag schreibt ALLEN Team-Mitgliedern die Stunden bilanz-neutral gut", async () => {
    const rows = await balanceRows(teamAId);
    const a1 = rows.find((r) => r.userId === assistantA1);
    const a2 = rows.find((r) => r.userId === assistantA2);
    expect(a1, "Assistent A1 fehlt in der Auswertung").toBeTruthy();
    expect(a2, "Assistent A2 fehlt in der Auswertung").toBeTruthy();

    for (const row of [a1!, a2!]) {
      expect(row.teamsitzungStunden).toBeCloseTo(TEAM_MEETING_HOURS, 5);
      // Bilanz-neutral: Gutschrift steckt in Soll UND Erfuellung.
      expect(row.plannedHours).toBeGreaterThanOrEqual(TEAM_MEETING_HOURS);
      expect(row.totalFulfilledHours).toBeGreaterThanOrEqual(TEAM_MEETING_HOURS);
      expect(row.plannedHours - row.totalFulfilledHours).toBeCloseTo(0, 5);
      // Ohne Vertrag/Stundenlohn keine Euro-Gutschrift.
      expect(row.teamsitzungEuro).toBe(0);
    }
  });

  test("Team-Scoping: Mitglieder eines anderen Teams erhalten KEINE Gutschrift", async () => {
    const rows = await balanceRows(teamBId);
    const b1 = rows.find((r) => r.userId === assistantB1);
    expect(b1, "Assistent B1 fehlt in der Auswertung").toBeTruthy();
    expect(b1!.teamsitzungStunden).toBe(0);
  });
});
