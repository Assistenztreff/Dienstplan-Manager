import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-Test für die Member-of-Team-Invariante bei POST /shifts (Rückbau der
 * Aushilfen-Ausnahme, #478):
 *
 * Der zugeordnete Nutzer (body.userId) muss Mitglied des ZIEL-Teams sein —
 * exakt wie bei contracts/time_tracking. Ein Assistent aus einem ANDEREN
 * eigenen Team des Dienstleisters ist KEIN gültiges Ziel mehr (früher als
 * Aushilfe erlaubt); Nutzer aus komplett fremden Konten bleiben ebenso 403.
 *
 * Abgedeckt:
 * - POST /shifts: Nutzer aus eigenem Team B in Team A -> 403.
 * - POST /shifts: Nutzer aus fremdem Konto -> 403.
 * - POST /shifts: Mitglied des Ziel-Teams -> 201 (Gegenprobe).
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

test("POST /shifts lehnt Nutzer aus anderem eigenen Team mit 403 ab (keine Aushilfen mehr)", async () => {
  const res = await h.ctx.post("/api/shifts", {
    data: {
      userId: assistantB,
      teamId: teamA,
      startTime: `${DAY}T08:00:00.000Z`,
      endTime: `${DAY}T16:00:00.000Z`,
      type: "work",
    },
  });
  expect(res.status(), "Nutzer aus Team B in Team A muss 403 liefern").toBe(403);

  // In keiner Team-Liste taucht eine neue Schicht des Team-B-Assistenten auf.
  const listA = (await (await h.ctx.get(`/api/shifts?teamId=${teamA}`)).json()) as Shift[];
  expect(listA.some((s) => s.userId === assistantB)).toBe(false);
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

test("POST /shifts erlaubt weiterhin Mitglieder des Ziel-Teams (201)", async () => {
  const res = await h.ctx.post("/api/shifts", {
    data: {
      userId: assistantA,
      teamId: teamA,
      startTime: `${DAY}T08:00:00.000Z`,
      endTime: `${DAY}T16:00:00.000Z`,
      type: "work",
    },
  });
  expect(res.status(), "Ziel-Team-Mitglied sollte 201 liefern").toBe(201);
  const shift = (await res.json()) as Shift;
  expect(shift.userId).toBe(assistantA);

  // Aufräumen im Spec selbst (Harness trackt nur eigene createShift-Aufrufe).
  await h.ctx.delete(`/api/shifts/${shift.id}`);
});
