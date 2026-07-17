import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-Tests für den Aushilfe-Einsatz (`einsatzTeamId` auf Schichten):
 *
 * Die Schicht bleibt im Stammteam (dort zählen die Stunden), wird aber im
 * Ziel-Team als schreibgeschützter Spiegel angezeigt. Serverregeln:
 * - einsatzTeamId muss ein ANDERES eigenes Team sein (gleiches Team -> 400,
 *   fremdes/unbekanntes Team -> 403).
 * - Abwesenheiten duerfen keinen Einsatz tragen (400); Typwechsel zu
 *   Abwesenheit nullt den Einsatz.
 * - GET /shifts?teamId=Ziel liefert den Spiegel mit (inkl. Namen),
 *   GET ?teamId=Stammteam weiterhin die Schicht selbst.
 */

const DAY = `${new Date().getFullYear()}-09-15`;

type ShiftDto = {
  id: number;
  userId: number;
  teamId?: number;
  einsatzTeamId?: number | null;
  einsatzTeamName?: string | null;
  homeTeamName?: string | null;
};

let h: TeamTestHarness;
let teamA: number;
let teamB: number;
let assistantA: number;

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();
  teamA = await h.createTeam("E2E Einsatz Stammteam");
  teamB = await h.createTeam("E2E Einsatz Zielteam");
  assistantA = await h.createUser({ role: "assistant", teamId: teamA });
});

test.afterAll(async () => {
  await h.cleanup();
});

test("POST /shifts mit einsatzTeamId legt Schicht im Stammteam an, Spiegel im Ziel-Team sichtbar", async () => {
  const res = await h.ctx.post("/api/shifts", {
    data: {
      userId: assistantA,
      teamId: teamA,
      startTime: `${DAY}T08:00:00.000Z`,
      endTime: `${DAY}T16:00:00.000Z`,
      type: "work",
      einsatzTeamId: teamB,
    },
  });
  expect(res.status(), "Einsatz in eigenem anderen Team muss 201 liefern").toBe(201);
  const shift = (await res.json()) as ShiftDto;
  expect(shift.einsatzTeamId).toBe(teamB);
  expect(shift.einsatzTeamName).toBe("E2E Einsatz Zielteam");

  // Stammteam-Liste enthaelt die Schicht regulaer.
  const listA = (await (await h.ctx.get(`/api/shifts?teamId=${teamA}`)).json()) as ShiftDto[];
  expect(listA.some((s) => s.id === shift.id)).toBe(true);

  // Ziel-Team-Liste enthaelt den Spiegel inkl. Stammteam-Name.
  const listB = (await (await h.ctx.get(`/api/shifts?teamId=${teamB}`)).json()) as ShiftDto[];
  const mirror = listB.find((s) => s.id === shift.id);
  expect(mirror, "Spiegel muss in der Ziel-Team-Liste erscheinen").toBeTruthy();
  expect(mirror!.einsatzTeamId).toBe(teamB);
  expect(mirror!.homeTeamName).toBe("E2E Einsatz Stammteam");

  // PATCH auf null entfernt den Spiegel wieder.
  const patch = await h.ctx.patch(`/api/shifts/${shift.id}`, {
    data: { einsatzTeamId: null },
  });
  expect(patch.ok(), `Einsatz entfernen fehlgeschlagen (${patch.status()})`).toBe(true);
  const listB2 = (await (await h.ctx.get(`/api/shifts?teamId=${teamB}`)).json()) as ShiftDto[];
  expect(listB2.some((s) => s.id === shift.id)).toBe(false);

  await h.ctx.delete(`/api/shifts/${shift.id}`);
});

test("einsatzTeamId = eigenes (gleiches) Team wird mit 400 abgelehnt", async () => {
  const res = await h.ctx.post("/api/shifts", {
    data: {
      userId: assistantA,
      teamId: teamA,
      startTime: `${DAY}T08:00:00.000Z`,
      endTime: `${DAY}T16:00:00.000Z`,
      type: "work",
      einsatzTeamId: teamA,
    },
  });
  expect(res.status(), "Gleiches Team als Einsatz-Ziel muss 400 liefern").toBe(400);
});

test("einsatzTeamId auf fremdes/unbekanntes Team wird mit 403 abgelehnt", async () => {
  const res = await h.ctx.post("/api/shifts", {
    data: {
      userId: assistantA,
      teamId: teamA,
      startTime: `${DAY}T08:00:00.000Z`,
      endTime: `${DAY}T16:00:00.000Z`,
      type: "work",
      einsatzTeamId: 999999999,
    },
  });
  expect(res.status(), "Fremdes Einsatz-Team muss 403 liefern").toBe(403);
});

test("Abwesenheit mit einsatzTeamId wird mit 400 abgelehnt", async () => {
  const res = await h.ctx.post("/api/shifts", {
    data: {
      userId: assistantA,
      teamId: teamA,
      startTime: `${DAY}T00:00:00.000Z`,
      endTime: `${DAY}T23:59:59.000Z`,
      type: "vacation",
      einsatzTeamId: teamB,
    },
  });
  expect(res.status(), "Abwesenheit darf keinen Einsatz tragen (400)").toBe(400);
});

test("Typwechsel zu Abwesenheit nullt den Einsatz", async () => {
  const create = await h.ctx.post("/api/shifts", {
    data: {
      userId: assistantA,
      teamId: teamA,
      startTime: `${DAY}T08:00:00.000Z`,
      endTime: `${DAY}T16:00:00.000Z`,
      type: "work",
      einsatzTeamId: teamB,
    },
  });
  expect(create.status()).toBe(201);
  const shift = (await create.json()) as ShiftDto;

  const patch = await h.ctx.patch(`/api/shifts/${shift.id}`, {
    data: { type: "sick", force: true },
  });
  expect(patch.ok(), `Typwechsel fehlgeschlagen (${patch.status()})`).toBe(true);
  const updated = (await patch.json()) as ShiftDto;
  expect(updated.einsatzTeamId ?? null).toBeNull();

  await h.ctx.delete(`/api/shifts/${shift.id}`);
});
