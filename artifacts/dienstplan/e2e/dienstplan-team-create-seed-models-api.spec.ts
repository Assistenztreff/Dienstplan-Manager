import { test, expect } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test (Task: Schicht-Dialog: Dienste team-bezogen laden):
 *
 * 1. Ein NEU angelegtes Team (POST /api/teams) startet mit den 5 Standard-
 *    Diensten (Frühdienst, Spätdienst, Nachtdienst, Bereitschaft, 24h Dienst) —
 *    wie bei der Registrierung. Vorher hatten Zusatz-Teams KEINE Dienste, und
 *    der Schicht-Dialog bot fremde Modelle an, deren Speichern der Server mit
 *    403 ablehnte.
 * 2. GET /api/shift-models?teamId=... liefert strikt nur die Modelle des
 *    angefragten Teams (Grundlage des Team-Filters im Schicht-Dialog).
 * 3. Sicherheits-Sanity: Das Anlegen einer Schicht mit einem TEAM-FREMDEN
 *    Schichtmodell wird weiterhin mit 403 "Schichtmodell gehört nicht zu
 *    diesem Team" abgelehnt (Server-Validierung unverändert).
 *
 * Aufbau: frisch registrierter Dienstleister (eigenes Standard-Team), per DB
 * auf Premium gehoben (maxTeams-Free-Limit = 1), dann ein zweites Team über
 * die API angelegt.
 */

type Team = { id: number; name: string };
type ShiftModel = { id: number; name: string; teamId?: number };
type Member = { userId: number };

const EXPECTED_MODEL_NAMES = [
  "24h Dienst",
  "Bereitschaft",
  "Frühdienst",
  "Nachtdienst",
  "Spätdienst",
];

let acc: FreeAccount;
let standardTeamId: number;
let newTeamId: number;

test.beforeAll(async () => {
  acc = await registerFreeAccount("dienstleister", "team-seed");
  await setAccountPlan(acc.email, "premium");

  const teamsRes = await acc.ctx.get("/api/teams");
  expect(teamsRes.ok()).toBe(true);
  const teams = (await teamsRes.json()) as Team[];
  expect(teams.length).toBe(1);
  standardTeamId = teams[0]!.id;
});

test.afterAll(async () => {
  // Zusatz-Team FK-sauber räumen (Modelle -> Mitglieder -> Team), dann das
  // Konto samt Standard-Team über den DB-Helfer entfernen. Best effort.
  try {
    if (newTeamId) {
      const modelsRes = await acc.ctx.get(`/api/shift-models?teamId=${newTeamId}`);
      if (modelsRes.ok()) {
        const models = (await modelsRes.json()) as ShiftModel[];
        for (const m of models) {
          await acc.ctx.delete(`/api/shift-models/${m.id}`).catch(() => {});
        }
      }
      const membersRes = await acc.ctx.get(`/api/teams/${newTeamId}/members`);
      if (membersRes.ok()) {
        const members = (await membersRes.json()) as Member[];
        for (const m of members) {
          await acc.ctx
            .delete(`/api/teams/${newTeamId}/members/${m.userId}`)
            .catch(() => {});
        }
      }
      await acc.ctx.delete(`/api/teams/${newTeamId}`).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  await deleteFreeAccount(acc);
});

test("Neues Team startet mit den 5 Standard-Diensten", async () => {
  const createRes = await acc.ctx.post("/api/teams", {
    data: { name: "E2E Seed-Team" },
  });
  expect(createRes.status(), await createRes.text()).toBe(201);
  newTeamId = ((await createRes.json()) as Team).id;
  expect(newTeamId).toBeGreaterThan(0);

  const modelsRes = await acc.ctx.get(`/api/shift-models?teamId=${newTeamId}`);
  expect(modelsRes.ok(), await modelsRes.text()).toBe(true);
  const models = (await modelsRes.json()) as ShiftModel[];
  expect(models.length, "Neues Team sollte 5 Standard-Dienste haben").toBe(5);
  expect(models.map((m) => m.name).sort()).toEqual(EXPECTED_MODEL_NAMES);
});

test("GET /shift-models?teamId liefert nur Modelle des angefragten Teams", async () => {
  const standardRes = await acc.ctx.get(`/api/shift-models?teamId=${standardTeamId}`);
  expect(standardRes.ok()).toBe(true);
  const standardModels = (await standardRes.json()) as ShiftModel[];
  expect(standardModels.length).toBe(5);

  const newRes = await acc.ctx.get(`/api/shift-models?teamId=${newTeamId}`);
  const newModels = (await newRes.json()) as ShiftModel[];

  // Kein Modell darf in beiden Antworten auftauchen (strikte Team-Trennung).
  const standardIds = new Set(standardModels.map((m) => m.id));
  for (const m of newModels) {
    expect(standardIds.has(m.id)).toBe(false);
  }
});

test("Schicht mit team-fremdem Modell wird weiterhin mit 403 abgelehnt", async () => {
  // Das Konto dem NEUEN Team als Mitglied hinzufügen, damit die
  // Member-of-Team-Invariante nicht VOR der Modell-Prüfung greift und der
  // Test wirklich die Schichtmodell-Validierung trifft.
  const addRes = await acc.ctx.post(`/api/teams/${newTeamId}/members`, {
    data: { userId: acc.id },
  });
  expect(addRes.status(), await addRes.text()).toBe(201);

  // Modell aus dem STANDARD-Team gegen das NEUE Team verwenden.
  const modelsRes = await acc.ctx.get(`/api/shift-models?teamId=${standardTeamId}`);
  const foreignModel = ((await modelsRes.json()) as ShiftModel[])[0]!;

  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId: acc.id,
      startTime: new Date("2026-08-03T08:00:00Z").toISOString(),
      endTime: new Date("2026-08-03T16:00:00Z").toISOString(),
      type: "work",
      shiftModelId: foreignModel.id,
      teamId: newTeamId,
    },
  });
  expect(res.status(), await res.text()).toBe(403);
  const body = (await res.json()) as { error?: string };
  expect(body.error ?? "").toContain("Schichtmodell");
});
