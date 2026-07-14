import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-Test für die Aushilfe-Regel (403-Fix, #469):
 *
 * Ein Dienstleister darf einen Assistenten aus einem ANDEREN seiner eigenen
 * Teams (Quell-Team) als Aushilfe in einen Dienst des aktuellen Plan-Teams
 * (Ziel-Team) eintragen. Die alte Member-of-Team-Invariante verlangte
 * Mitgliedschaft im Ziel-Team und lehnte das mit 403 ab. Neu genügt
 * Mitgliedschaft in irgendeinem erlaubten Team des Anfragers
 * (isUserInAllowedTeams); Nutzer aus komplett fremden Konten bleiben 403.
 *
 * Abgedeckt:
 * - POST /shifts: Aushilfe aus Team B in Team A -> 201; Schicht liegt im
 *   Ziel-Team A (erscheint in der Team-A-Liste, nicht in Team B).
 * - POST /shifts: Nutzer aus fremdem Konto -> weiterhin 403.
 * - PATCH /shifts (Assistenten-Wechsel/bulkEdit): Wechsel auf Aushilfe aus
 *   Team B -> 200; Wechsel auf fremden Nutzer -> 403.
 */

const DAY = `${new Date().getFullYear()}-08-12`;

let h: TeamTestHarness;
let teamA: number;
let teamB: number;
let assistantA: number;
let assistantB: number;
let foreignAdminId: number;

type Shift = { id: number; userId: number };

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  teamA = await h.createTeam("E2E Aushilfe Team A");
  teamB = await h.createTeam("E2E Aushilfe Team B");
  assistantA = await h.createUser({ role: "assistant", teamId: teamA });
  assistantB = await h.createUser({ role: "assistant", teamId: teamB });

  // Fremdes Konto (kein Team des Dienstleisters): darf NIE zuweisbar sein.
  const foreign = await h.seedForeignAdmin();
  foreignAdminId = foreign.id;
});

test.afterAll(async () => {
  await h.cleanup();
});

test("POST /shifts erlaubt Aushilfe aus anderem eigenen Team, Schicht landet im Ziel-Team", async () => {
  const res = await h.ctx.post("/api/shifts", {
    data: {
      userId: assistantB,
      teamId: teamA,
      startTime: `${DAY}T08:00:00.000Z`,
      endTime: `${DAY}T16:00:00.000Z`,
      type: "work",
    },
  });
  expect(res.status(), "Aushilfe aus Team B in Team A sollte 201 liefern").toBe(201);
  const shift = (await res.json()) as Shift;
  expect(shift.userId).toBe(assistantB);

  // Die Schicht liegt im Ziel-Team A (Plan-Team), NICHT im Quell-Team B.
  const listA = (await (await h.ctx.get(`/api/shifts?teamId=${teamA}`)).json()) as Shift[];
  expect(listA.some((s) => s.id === shift.id)).toBe(true);
  const listB = (await (await h.ctx.get(`/api/shifts?teamId=${teamB}`)).json()) as Shift[];
  expect(listB.some((s) => s.id === shift.id)).toBe(false);

  // Aufräumen im Spec selbst (Harness trackt nur eigene createShift-Aufrufe).
  await h.ctx.delete(`/api/shifts/${shift.id}`);
});

test("POST /shifts lehnt Nutzer aus komplett fremdem Konto weiterhin mit 403 ab", async () => {
  const res = await h.ctx.post("/api/shifts", {
    data: {
      userId: foreignAdminId,
      teamId: teamA,
      startTime: `${DAY}T08:00:00.000Z`,
      endTime: `${DAY}T16:00:00.000Z`,
      type: "work",
    },
  });
  expect(res.status(), "Fremder Nutzer muss 403 bleiben").toBe(403);
});

test("PATCH /shifts erlaubt Assistenten-Wechsel auf Aushilfe, blockt fremde Nutzer", async () => {
  // Schicht in Team A mit Team-A-Assistent (anderer Tag, keine Überschneidung).
  const otherDay = `${new Date().getFullYear()}-08-13`;
  const shiftId = await h.createShift(teamA, assistantA, otherDay);

  // Wechsel auf die Aushilfe aus Team B (bulkEdit-Pfad) -> erlaubt.
  const okRes = await h.ctx.patch(`/api/shifts/${shiftId}`, {
    data: { userId: assistantB },
  });
  expect(okRes.status(), "Wechsel auf Aushilfe aus Team B sollte 200 liefern").toBe(200);
  const updated = (await okRes.json()) as Shift;
  expect(updated.userId).toBe(assistantB);

  // Wechsel auf einen komplett fremden Nutzer -> weiterhin 403.
  const forbiddenRes = await h.ctx.patch(`/api/shifts/${shiftId}`, {
    data: { userId: foreignAdminId },
  });
  expect(forbiddenRes.status(), "Fremder Nutzer muss beim PATCH 403 bleiben").toBe(403);
});
