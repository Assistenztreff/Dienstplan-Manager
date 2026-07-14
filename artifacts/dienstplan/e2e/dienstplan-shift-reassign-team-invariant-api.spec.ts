import { test, expect } from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-Test für die Member-of-Team-Invariante beim Assistenten-Wechsel via PATCH
 * (#190 — Absicherung der mit #145 eingeführten Massen-Umbuchung).
 *
 * Hintergrund: PATCH /api/shifts/:id akzeptiert als bisher EINZIGER PATCH-Body
 * ein optionales `userId` (Assistenten-Tausch der Massenbearbeitung "Einträge
 * ändern"). Weil das Umbuchen einer Schicht die per User-Join zurückgegebene PII
 * des neuen Assistenten offenlegt, MUSS der Handler dieselbe Invariante wie POST
 * erzwingen. Seit dem Aushilfe-Fix (#469) gilt: Mitgliedschaft in irgendeinem
 * ERLAUBTEN Team des Anfragers genügt (`isUserInAllowedTeams`) — ein Assistent
 * aus einem anderen eigenen Team ist ein gültiges Umbuchungsziel; Nutzer aus
 * komplett FREMDEN Konten bleiben 403. Zusätzlich muss die Überschneidungs-
 * prüfung gegen den NEUEN Assistenten laufen. Dieser Test sichert beide Grenzen
 * gegen ein späteres Refactor ab.
 *
 * Der Setup-Admin ist in der Test-DB auf `plan = 'premium'` gehoben, daher greift
 * das vorgelagerte `bulkEdit`-Feature-Gate hier nicht — getestet wird gezielt die
 * Team-/Überschneidungs-Grenze, nicht das Plan-Gating (das deckt ein eigener Spec).
 *
 * Aufbau:
 * - Team A und Team B desselben Dienstleisters.
 * - `insider` ist Mitglied von Team A (gültiges Umbuchungs-Ziel).
 * - `outsider` ist NUR Mitglied von Team B — seit #469 als Aushilfe ERLAUBT.
 * - `foreignAdmin` ist ein komplett fremdes Konto (kein Team des Anfragers) —
 *   weiterhin 403.
 */

const YEAR = new Date().getFullYear();
// Eigener Tag je Test, damit sich die Schichten desselben `owner` nicht
// gegenseitig als Überschneidung blockieren.
const DAY = `${YEAR}-06-20`;
const REASSIGN_DAY = `${YEAR}-06-22`;
const OVERLAP_DAY = `${YEAR}-06-21`;

type Shift = { id: number; userId: number; user?: { id: number } };

let h: TeamTestHarness;
let teamA: number;
let teamB: number;
let owner: number;
let insider: number;
let outsider: number;
let foreignAdminId: number;

test.beforeAll(async () => {
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  teamA = await h.createTeam("E2E Reassign Team A");
  teamB = await h.createTeam("E2E Reassign Team B");

  // Ursprünglicher Assistent der Schicht + gültiges Team-A-Umbuchungsziel.
  owner = await h.createUser({ role: "assistant", teamId: teamA });
  insider = await h.createUser({ role: "assistant", teamId: teamA });
  // Teamfremd bzgl. Team A: nur Mitglied in Team B (seit #469 gültige Aushilfe).
  outsider = await h.createUser({ role: "assistant", teamId: teamB });
  // Komplett fremdes Konto: in KEINEM Team des Anfragers.
  const foreign = await h.seedForeignAdmin();
  foreignAdminId = foreign.id;
});

test.afterAll(async () => {
  await h.cleanup();
});

test("PATCH /api/shifts lehnt Umbuchung auf Nutzer aus fremdem Konto mit 403 ab, erlaubt Aushilfe aus eigenem Team B", async () => {
  const shiftId = await h.createShift(teamA, owner, DAY);

  // Komplett fremder Nutzer (kein Team des Anfragers) -> weiterhin 403.
  const res = await h.ctx.patch(`/api/shifts/${shiftId}`, {
    data: { userId: foreignAdminId },
  });
  expect(res.status(), "Umbuchung auf kontofremden Nutzer sollte 403 liefern").toBe(403);

  // Die Schicht bleibt beim ursprünglichen Assistenten (PATCH nicht angewandt) —
  // die PII des fremden Nutzers wird nicht über die Team-A-Schicht offengelegt.
  const check = await h.ctx.get(`/api/shifts/${shiftId}`);
  expect(check.ok(), "GET der Schicht fehlgeschlagen").toBe(true);
  const shift = (await check.json()) as Shift;
  expect(shift.userId).toBe(owner);

  // Aushilfe aus dem eigenen Team B ist seit #469 ein GÜLTIGES Umbuchungsziel.
  const okRes = await h.ctx.patch(`/api/shifts/${shiftId}`, {
    data: { userId: outsider },
  });
  expect(okRes.status(), "Umbuchung auf Aushilfe aus Team B sollte 200 liefern").toBe(200);
  const updated = (await okRes.json()) as Shift;
  expect(updated.userId).toBe(outsider);
});

test("PATCH /api/shifts bucht auf ein gültiges Team-Mitglied um (200)", async () => {
  const shiftId = await h.createShift(teamA, owner, REASSIGN_DAY, {
    startTime: `${REASSIGN_DAY}T08:00:00.000Z`,
    endTime: `${REASSIGN_DAY}T09:00:00.000Z`,
  });

  const res = await h.ctx.patch(`/api/shifts/${shiftId}`, {
    data: { userId: insider },
  });
  expect(res.status(), "Umbuchung auf Team-A-Mitglied sollte 200 liefern").toBe(200);
  const updated = (await res.json()) as Shift;
  expect(updated.userId).toBe(insider);
  expect(updated.user?.id).toBe(insider);
});

test("PATCH /api/shifts prüft Überschneidung gegen den NEUEN Assistenten (409 shift_overlap)", async () => {
  // Schicht des ursprünglichen Assistenten, die umgebucht werden soll.
  const shiftId = await h.createShift(teamA, owner, OVERLAP_DAY, {
    startTime: `${OVERLAP_DAY}T08:00:00.000Z`,
    endTime: `${OVERLAP_DAY}T16:00:00.000Z`,
  });

  // Der Ziel-Assistent hat am selben Tag bereits eine überschneidende Schicht.
  await h.createShift(teamA, insider, OVERLAP_DAY, {
    startTime: `${OVERLAP_DAY}T10:00:00.000Z`,
    endTime: `${OVERLAP_DAY}T12:00:00.000Z`,
  });

  const res = await h.ctx.patch(`/api/shifts/${shiftId}`, {
    data: { userId: insider },
  });
  expect(res.status(), "Umbuchung mit Kollision beim Ziel sollte 409 liefern").toBe(409);
  const body = (await res.json()) as { code?: string };
  expect(body.code).toBe("shift_overlap");

  // Umbuchung wurde nicht angewandt — die Schicht bleibt beim ursprünglichen Nutzer.
  const check = await h.ctx.get(`/api/shifts/${shiftId}`);
  expect(check.ok(), "GET der Schicht fehlgeschlagen").toBe(true);
  const shift = (await check.json()) as Shift;
  expect(shift.userId).toBe(owner);
});
