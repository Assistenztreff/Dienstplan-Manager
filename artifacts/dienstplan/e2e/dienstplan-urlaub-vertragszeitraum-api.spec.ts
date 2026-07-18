import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { TeamTestHarness } from "./helpers/teams";

/**
 * API-Tests für den serverseitigen Vertragszeitraum-Guard bei URLAUB.
 *
 * Hintergrund: Urlaub außerhalb jedes Vertragszeitraums wird nie vom
 * Urlaubszähler (contracts.vacationHoursUsed) abgezogen, weil
 * adjustVacationHours zu dem Datum keinen aktiven Vertrag findet — der
 * Resturlaub stimmt dann still nicht mehr. Der Server blockiert das Anlegen
 * (POST) und Verschieben (PATCH) solcher Urlaube mit 400
 * "vacation_outside_contract".
 *
 * Abgesichert wird:
 * - Urlaub VOR Vertragsbeginn -> 400, kein Eintrag, Zähler unverändert.
 * - Urlaub IM Vertragszeitraum -> 201, Zähler steigt.
 * - PATCH eines Urlaubs aus dem Zeitraum heraus -> 400, Schicht unverändert.
 * - Krankheit vor Vertragsbeginn -> weiterhin erlaubt (201).
 * - Assistenzkraft GANZ OHNE Vertrag -> Urlaub uneingeschränkt erlaubt (201).
 * - Team-Scope: Vertrag NUR im anderen Team deckt keinen Urlaub im aktuellen
 *   Team (400) und die Fehlermeldung leakt keine teamfremden Vertragsdaten.
 *
 * Alle Daten liegen in der Vergangenheit (relativ zum Testlauf), damit weder
 * das Free-Vorausplanungs-Limit noch Jahresgrenzen hineinspielen.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Vergangenheits-Daten relativ zu heute: Vertrag ab Monatsersten vor 2 Monaten,
// Urlaub im Zeitraum im Vormonat, Urlaub davor 3 Monate zurück.
function monthShift(deltaMonths: number, day: number): string {
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth() + deltaMonths, day);
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  return `${t.getFullYear()}-${mm}-${dd}`;
}

const CONTRACT_START = monthShift(-2, 1);
const IN_RANGE_DAY = monthShift(-1, 15);
const BEFORE_DAY = monthShift(-3, 15);
const SICK_DAY = monthShift(-3, 16);
const PATCH_OUT_DAY = monthShift(-3, 20);

function dayIso(day: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${day}T00:00:00`).toISOString(),
    endTime: new Date(`${day}T23:59:59`).toISOString(),
  };
}

type CreatedUser = { id: number };
type Contract = { id: number; vacationHoursUsed: number };
type Shift = { id: number; userId: number; type: string; startTime: string };

let adminCtx: APIRequestContext;
let withContract: CreatedUser;
let withoutContract: CreatedUser;
let contractId: number;

async function createAssistant(suffix: string): Promise<CreatedUser> {
  const res = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Vertragszeitraum ${suffix}`,
      email: `e2e.vertragszeitraum.${suffix}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as CreatedUser;
}

async function vacationHoursUsed(userId: number): Promise<number> {
  const res = await adminCtx.get(`/api/contracts?userId=${userId}`);
  expect(res.ok(), "GET /api/contracts fehlgeschlagen").toBe(true);
  const contracts = (await res.json()) as Contract[];
  const contract = contracts.find((c) => c.id === contractId);
  expect(contract, "Vertrag nicht gefunden").toBeTruthy();
  return contract!.vacationHoursUsed;
}

async function listAbsences(userId: number, type: string): Promise<Shift[]> {
  const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${userId}`);
  expect(res.ok(), `GET /api/shifts (${type}) fehlgeschlagen`).toBe(true);
  return ((await res.json()) as Shift[]).filter((s) => s.userId === userId);
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  withContract = await createAssistant(`mit.${unique}`);
  withoutContract = await createAssistant(`ohne.${unique}`);

  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: withContract.id,
      startDate: CONTRACT_START,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), "Anlegen des Vertrags fehlgeschlagen").toBe(true);
  contractId = ((await contractRes.json()) as Contract).id;
});

test.afterAll(async () => {
  for (const user of [withContract, withoutContract]) {
    if (!user?.id) continue;
    for (const type of ["vacation", "sick"]) {
      const res = await adminCtx.get(`/api/shifts?type=${type}&userId=${user.id}`);
      if (res.ok()) {
        const shifts = (await res.json()) as Shift[];
        for (const s of shifts.filter((s) => s.userId === user.id)) {
          await adminCtx.delete(`/api/shifts/${s.id}`);
        }
      }
    }
  }
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (withContract?.id) await adminCtx.delete(`/api/users/${withContract.id}`);
  if (withoutContract?.id) await adminCtx.delete(`/api/users/${withoutContract.id}`);
  await adminCtx.dispose();
});

test("Urlaub vor Vertragsbeginn wird mit 400 abgelehnt, ohne Eintrag und ohne Abzug", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: { userId: withContract.id, type: "vacation", ...dayIso(BEFORE_DAY) },
  });
  expect(res.status(), "Urlaub vor Vertragsbeginn sollte 400 liefern").toBe(400);
  const body = (await res.json()) as { code?: string; error?: string };
  expect(body.code).toBe("vacation_outside_contract");
  expect(body.error).toContain("Vertragszeitraums");
  expect(body.error).toContain("Vertrag ab");

  expect((await listAbsences(withContract.id, "vacation")).length).toBe(0);
  expect(await vacationHoursUsed(withContract.id)).toBe(0);
});

test("Urlaub im Vertragszeitraum wird angelegt und der Zähler steigt", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: { userId: withContract.id, type: "vacation", ...dayIso(IN_RANGE_DAY) },
  });
  expect(res.status(), "Urlaub im Vertragszeitraum sollte 201 liefern").toBe(201);
  expect((await listAbsences(withContract.id, "vacation")).length).toBe(1);
  // 1 ganztägiger Urlaubstag = 8 Stunden (vacationHoursPerDay-Default).
  expect(await vacationHoursUsed(withContract.id)).toBe(8);
});

test("PATCH aus dem Vertragszeitraum heraus wird mit 400 abgelehnt, Schicht bleibt unverändert", async () => {
  const [shift] = await listAbsences(withContract.id, "vacation");
  expect(shift, "Urlaubs-Schicht aus dem vorherigen Test fehlt").toBeTruthy();

  const res = await adminCtx.patch(`/api/shifts/${shift!.id}`, {
    data: dayIso(PATCH_OUT_DAY),
  });
  expect(res.status(), "Verschieben vor Vertragsbeginn sollte 400 liefern").toBe(400);
  const body = (await res.json()) as { code?: string };
  expect(body.code).toBe("vacation_outside_contract");

  // Schicht unverändert am Ursprungstag, Zähler unverändert.
  const [after] = await listAbsences(withContract.id, "vacation");
  expect(after!.startTime.split("T")[0]).toBe(
    new Date(`${IN_RANGE_DAY}T00:00:00`).toISOString().split("T")[0]
  );
  expect(await vacationHoursUsed(withContract.id)).toBe(8);
});

test("Krankheit vor Vertragsbeginn bleibt erlaubt", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: { userId: withContract.id, type: "sick", ...dayIso(SICK_DAY) },
  });
  expect(res.status(), "Krankheit vor Vertragsbeginn sollte 201 liefern").toBe(201);
  // Krankheit belastet den Urlaubszähler nicht.
  expect(await vacationHoursUsed(withContract.id)).toBe(8);
});

test("Assistenzkraft ohne Vertrag kann weiterhin uneingeschränkt Urlaub eintragen", async () => {
  const res = await adminCtx.post("/api/shifts", {
    data: { userId: withoutContract.id, type: "vacation", ...dayIso(BEFORE_DAY) },
  });
  expect(res.status(), "Urlaub ohne jeden Vertrag sollte 201 liefern").toBe(201);
  expect((await listAbsences(withoutContract.id, "vacation")).length).toBe(1);
});

test("Team-Scope: Vertrag nur im ANDEREN Team deckt keinen Urlaub im aktuellen Team", async () => {
  // Dienstleister mit zwei Teams; Assistenzkraft ist Mitglied in BEIDEN,
  // hat aber nur in Team B einen Vertrag. Urlaub in Team A muss 400 liefern,
  // ohne die Vertragsdaten aus Team B in der Meldung zu reflektieren.
  const h = await TeamTestHarness.login();
  try {
    await h.becomeDienstleister();
    const teamA = await h.createTeam("E2E VZ Team A");
    const teamB = await h.createTeam("E2E VZ Team B");
    const userId = await h.createUser({ teamId: teamA, role: "assistant" });
    const addRes = await h.ctx.post(`/api/teams/${teamB}/members`, {
      data: { userId },
    });
    expect(addRes.ok(), "Mitgliedschaft in Team B fehlgeschlagen").toBe(true);
    await h.createContract(teamB, userId, { startDate: CONTRACT_START });

    const res = await h.ctx.post("/api/shifts", {
      data: { userId, teamId: teamA, type: "vacation", ...dayIso(IN_RANGE_DAY) },
    });
    expect(
      res.status(),
      "Urlaub im Team ohne eigenen Vertrag sollte 400 liefern"
    ).toBe(400);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("vacation_outside_contract");
    // Keine teamfremden Vertragsdaten in der Meldung (kein "Vertrag ab/bis ...").
    expect(body.error).not.toContain("Vertrag ab");
    expect(body.error).not.toContain("Vertrag bis");

    // Im Vertrags-Team B bleibt derselbe Urlaub erlaubt.
    const okRes = await h.ctx.post("/api/shifts", {
      data: { userId, teamId: teamB, type: "vacation", ...dayIso(IN_RANGE_DAY) },
    });
    expect(okRes.status(), "Urlaub im Vertrags-Team sollte 201 liefern").toBe(201);
  } finally {
    await h.cleanup();
  }
});
