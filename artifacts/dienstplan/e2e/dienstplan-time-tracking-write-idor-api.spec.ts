import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: SCHREIB-Seite der Zeiterfassung —
 * `PATCH /time-tracking/:id`, `DELETE /time-tracking/:id` und
 * `PATCH /time-tracking/:id/confirm`.
 *
 * Die LESE-Seite ist bereits abgesichert (dienstplan-team-isolation.spec.ts:
 * GET-Listen + GET /time-tracking/:id -> 404). Hier geht es um die
 * Tenant-Grenze beim SCHREIBEN: Ein fremder Arbeitgeber Q darf eine Ist-Zeit
 * aus Konto P weder aendern noch loeschen noch bestaetigen — laut
 * Team-Scoping-Invariante muss jeweils 404 kommen (kein 403, damit die
 * Existenz fremder Eintrags-IDs nicht bestaetigt wird). Eine Regression
 * (z. B. Wegfall des `teamId ∈ allowedTeams`-Checks im UPDATE/DELETE-WHERE)
 * wuerde es einem fremden Arbeitgeber erlauben, lohnrelevante Ist-Zeiten zu
 * manipulieren, zu bestaetigen oder zu loeschen.
 *
 * Aufbau (Muster: dienstplan-contracts-write-idor-api.spec.ts):
 * - Arbeitgeber P (privat, free) mit Assistent + Schicht + Ist-Zeit im
 *   Standard-Team.
 * - Getrennter Arbeitgeber Q (privat) mit eigenem Assistenten + Ist-Zeit
 *   (Positivkontrolle fuer die Q-Session). Q wird fuer den confirm-Angriff
 *   auf Premium gehoben (strictTimeTracking ist Premium-gegated — sonst
 *   wuerde der Angriff schon am Plan-Gate mit 403 enden und nichts ueber
 *   die Tenant-Grenze beweisen).
 *
 * Geprueft (Done-Kriterien):
 * 1. Admin Q -> PATCH auf die P-Ist-Zeit (actualStart/actualEnd): 404.
 * 2. Admin Q -> DELETE auf die P-Ist-Zeit: 404.
 * 3. Admin Q (Premium) -> PATCH .../confirm auf die P-Ist-Zeit: 404.
 * 4. Nachkontrolle ueber P: Eintrag existiert UNVERAENDERT (Zeiten,
 *    Stunden, Status pending, confirmedBy null).
 * 5. Positivkontrolle: P kann den EIGENEN Eintrag aendern (200).
 * 6. Positivkontrolle: Q kann den EIGENEN Eintrag aendern (200) — belegt,
 *    dass die 404 am Scope lag, nicht an einem Defekt der Q-Session.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type TimeEntryRow = {
  id: number;
  actualStart: string;
  actualEnd: string;
  actualHours: number;
  status: string;
  confirmedBy: number | null;
};

const P_START = "2026-07-01T08:00:00.000Z";
const P_END = "2026-07-01T16:00:00.000Z";
const P_HOURS = 8;

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pEntryId = 0;
let qEntryId = 0;

async function createAssistant(acc: FreeAccount, label: string): Promise<number> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E TtWriteIdor ${label} ${unique}`,
      email: `e2e.ttwriteidor.${label}.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.status(), `Assistent (${label}) anlegen sollte 201 liefern`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createTimeEntry(
  acc: FreeAccount,
  userId: number,
  start: string,
  end: string,
): Promise<number> {
  const res = await acc.ctx.post("/api/time-tracking", {
    data: { userId, actualStart: start, actualEnd: end },
  });
  expect(res.status(), "Ist-Zeit anlegen sollte 201 liefern").toBe(201);
  return ((await res.json()) as { id: number }).id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);

  // --- Arbeitgeber P mit Assistent + Schicht + Ist-Zeit ---------------------
  employerP = await registerFreeAccount("privat", "ttwriteidor-p");
  const pAssistantId = await createAssistant(employerP, "p");
  // Schicht anlegen (Done-Kriterium: P legt Assistent + Schicht + Ist-Zeit an);
  // die Ist-Zeit selbst bleibt bewusst OHNE shiftId, damit PATCH/DELETE die
  // reine Team-Scoping-Grenze zeigen (keine Nebenwirkungen des shiftId-Pfads).
  const shiftRes = await employerP.ctx.post("/api/shifts", {
    data: {
      userId: pAssistantId,
      startTime: P_START,
      endTime: P_END,
      type: "active",
    },
  });
  expect(shiftRes.status(), "Schicht (P) anlegen sollte 201 liefern").toBe(201);
  pEntryId = await createTimeEntry(employerP, pAssistantId, P_START, P_END);

  // --- Getrennter Arbeitgeber Q mit eigenem Assistent + Ist-Zeit ------------
  employerQ = await registerFreeAccount("privat", "ttwriteidor-q");
  const qAssistantId = await createAssistant(employerQ, "q");
  qEntryId = await createTimeEntry(
    employerQ,
    qAssistantId,
    "2026-07-02T08:00:00.000Z",
    "2026-07-02T16:00:00.000Z",
  );

  // Q auf Premium heben, damit der confirm-Angriff NICHT am Plan-Gate (403
  // plan_feature_required) endet, sondern die Tenant-Grenze (404) beweist.
  await setAccountPlan(employerQ.email, "premium");
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("Admin Q bekommt 404 beim PATCH auf eine fremde Ist-Zeit", async () => {
  const res = await employerQ.ctx.patch(`/api/time-tracking/${pEntryId}`, {
    data: {
      actualStart: "2026-07-01T00:00:00.000Z",
      actualEnd: "2026-07-01T23:00:00.000Z",
    },
  });
  expect(
    res.status(),
    "SICHERHEIT: PATCH auf fremde Tenant-Ist-Zeit muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
  const body = await res.text();
  expect(body, "404-Antwort darf keine Eintragsdaten enthalten").not.toContain("actualHours");
});

test("Admin Q bekommt 404 beim DELETE auf eine fremde Ist-Zeit", async () => {
  const res = await employerQ.ctx.delete(`/api/time-tracking/${pEntryId}`);
  expect(
    res.status(),
    "SICHERHEIT: DELETE auf fremde Tenant-Ist-Zeit muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
});

test("Admin Q (Premium) bekommt 404 beim Bestaetigen einer fremden Ist-Zeit", async () => {
  const res = await employerQ.ctx.patch(`/api/time-tracking/${pEntryId}/confirm`, {
    data: { status: "confirmed" },
  });
  expect(
    res.status(),
    "SICHERHEIT: confirm auf fremde Tenant-Ist-Zeit muss 404 liefern (nicht 403 — Premium-Gate ist fuer Q erfuellt)",
  ).toBe(404);
});

test("Nachkontrolle P: Ist-Zeit existiert unveraendert weiter", async () => {
  const res = await employerP.ctx.get(`/api/time-tracking/${pEntryId}`);
  expect(res.status(), "P-Eintrag muss nach den Fremd-Angriffen noch existieren").toBe(200);
  const body = (await res.json()) as TimeEntryRow;
  expect(body.id).toBe(pEntryId);
  expect(
    new Date(body.actualStart).toISOString(),
    "actualStart darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(P_START);
  expect(
    new Date(body.actualEnd).toISOString(),
    "actualEnd darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(P_END);
  expect(
    Number(body.actualHours),
    "actualHours darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(P_HOURS);
  expect(
    body.status,
    "Status muss trotz fremdem confirm-Versuch offen (pending) bleiben",
  ).toBe("pending");
  expect(
    body.confirmedBy,
    "confirmedBy darf durch den fremden confirm-Versuch nicht gesetzt sein",
  ).toBeNull();
});

test("Positivkontrolle: Admin P kann die eigene Ist-Zeit aendern (200)", async () => {
  const res = await employerP.ctx.patch(`/api/time-tracking/${pEntryId}`, {
    data: {
      actualStart: "2026-07-01T09:00:00.000Z",
      actualEnd: "2026-07-01T15:00:00.000Z",
    },
  });
  expect(res.status(), "Eigene Ist-Zeit muss per PATCH aenderbar sein").toBe(200);
  const body = (await res.json()) as TimeEntryRow;
  expect(
    Number(body.actualHours),
    "PATCH muss actualHours aus den neuen Zeiten neu berechnen",
  ).toBe(6);
});

test("Positivkontrolle: Admin Q kann die eigene Ist-Zeit aendern (404 lag am Scope)", async () => {
  const res = await employerQ.ctx.patch(`/api/time-tracking/${qEntryId}`, {
    data: {
      actualStart: "2026-07-02T10:00:00.000Z",
      actualEnd: "2026-07-02T14:00:00.000Z",
    },
  });
  expect(res.status(), "Eigene Ist-Zeit von Q muss per PATCH aenderbar sein").toBe(200);
  const body = (await res.json()) as TimeEntryRow;
  expect(
    Number(body.actualHours),
    "PATCH muss actualHours aus den neuen Zeiten neu berechnen",
  ).toBe(4);
});
