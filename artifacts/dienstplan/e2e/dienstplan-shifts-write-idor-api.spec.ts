import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test: SCHREIB-Seite des Schicht-Endpunkts —
 * `PATCH /shifts/:id` und `DELETE /shifts/:id`.
 *
 * Die Lese-Seite ist bereits abgesichert (dienstplan-team-isolation.spec.ts:
 * Listen-Scoping + GET /shifts/:id → 404 bei fremdem Tenant). Hier geht es um
 * die Tenant-Grenze beim SCHREIBEN: Ein Admin Q darf eine Schicht aus Konto P
 * (fremder Tenant) weder aendern noch loeschen — laut Team-Scoping-Invariante
 * muss beides 404 liefern (kein 403, damit die Existenz fremder Schicht-IDs
 * nicht bestaetigt wird). Eine Regression (z. B. Wegfall des
 * `teamId ∈ allowedTeams`-Checks vor dem UPDATE/DELETE) wuerde es einem
 * fremden Arbeitgeber erlauben, Dienstplaene anderer Konten zu manipulieren
 * (Zeiten verschieben, Schichten verbindlich stellen via planningStatus: FIX)
 * oder Schichten zu loeschen.
 *
 * Aufbau:
 * - Arbeitgeber P (privat) mit Assistent + Schicht im Standard-Team
 *   (resolveWriteTeamId greift ohne explizite teamId).
 * - Zweiter, komplett getrennter Arbeitgeber Q (privat) mit eigenem
 *   Assistenten + eigener Schicht (Positivkontrolle fuer die Q-Session).
 *   Schicht-CRUD im aktuellen Monat ist nicht plan-gegated (historyMonths
 *   erlaubt Free den aktuellen + naechsten Monat), Free-Konten genuegen.
 *
 * Geprueft (Done-Kriterien):
 * 1. Admin Q → PATCH auf die P-Schicht (startTime/endTime): 404.
 * 2. Admin Q → PATCH auf die P-Schicht (planningStatus: FIX + force): 404 —
 *    ein Fremder darf einen fremden Dienstplan nicht verbindlich stellen.
 * 3. Admin Q → DELETE auf die P-Schicht: 404.
 * 4. Nachkontrolle ueber P: GET liefert die Schicht UNVERAENDERT
 *    (startTime/endTime/planningStatus wie beim Anlegen, Schicht existiert).
 * 5. Positivkontrolle: P kann die EIGENE Schicht aendern (200).
 * 6. Positivkontrolle: Q kann die EIGENE Schicht aendern (200) — belegt,
 *    dass die 404 am Scope lag, nicht an einem Defekt der Q-Session.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type ShiftRow = {
  id: number;
  startTime: string;
  endTime: string;
  planningStatus: string;
};

// Aktueller Monat (Config laeuft mit fixierter Zeitbasis ist nicht gegeben,
// daher dynamisch): Free-Konten duerfen im aktuellen + naechsten Monat planen.
const now = new Date();
const DAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
const P_START = `${DAY}T08:00:00.000Z`;
const P_END = `${DAY}T16:00:00.000Z`;

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pShiftId = 0;
let qShiftId = 0;
let pPlanningStatus = "";

async function createAssistant(acc: FreeAccount, label: string): Promise<number> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E ShiftWriteIdor ${label} ${unique}`,
      email: `e2e.shiftwriteidor.${label}.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.status(), `Assistent (${label}) anlegen sollte 201 liefern`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createShift(acc: FreeAccount, userId: number): Promise<ShiftRow> {
  const res = await acc.ctx.post("/api/shifts", {
    data: {
      userId,
      startTime: P_START,
      endTime: P_END,
      type: "active",
    },
  });
  expect(res.status(), "Schicht anlegen sollte 201 liefern").toBe(201);
  return (await res.json()) as ShiftRow;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);

  // --- Arbeitgeber P mit Assistent + Schicht --------------------------------
  employerP = await registerFreeAccount("privat", "shiftwriteidor-p");
  const pAssistantId = await createAssistant(employerP, "p");
  const pShift = await createShift(employerP, pAssistantId);
  pShiftId = pShift.id;
  pPlanningStatus = pShift.planningStatus;

  // --- Getrennter Arbeitgeber Q mit eigenem Assistent + Schicht -------------
  employerQ = await registerFreeAccount("privat", "shiftwriteidor-q");
  const qAssistantId = await createAssistant(employerQ, "q");
  qShiftId = (await createShift(employerQ, qAssistantId)).id;
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("Admin Q bekommt 404 beim PATCH (Zeiten) auf eine fremde Schicht", async () => {
  const res = await employerQ.ctx.patch(`/api/shifts/${pShiftId}`, {
    data: {
      startTime: `${DAY}T10:00:00.000Z`,
      endTime: `${DAY}T18:00:00.000Z`,
    },
  });
  expect(
    res.status(),
    "SICHERHEIT: PATCH auf fremde Tenant-Schicht muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
  const body = await res.text();
  expect(body, "404-Antwort darf keine Schichtdaten enthalten").not.toContain("startTime");
});

test("Admin Q bekommt 404 beim Verbindlich-Stellen (planningStatus FIX) einer fremden Schicht", async () => {
  const res = await employerQ.ctx.patch(`/api/shifts/${pShiftId}`, {
    data: { planningStatus: "FIX", force: true },
  });
  expect(
    res.status(),
    "SICHERHEIT: Fremde duerfen fremde Schichten nicht verbindlich stellen (404)",
  ).toBe(404);
});

test("Admin Q bekommt 404 beim DELETE auf eine fremde Schicht", async () => {
  const res = await employerQ.ctx.delete(`/api/shifts/${pShiftId}`);
  expect(
    res.status(),
    "SICHERHEIT: DELETE auf fremde Tenant-Schicht muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
});

test("Nachkontrolle P: Schicht existiert unveraendert weiter", async () => {
  const res = await employerP.ctx.get(`/api/shifts/${pShiftId}`);
  expect(res.status(), "P-Schicht muss nach den Fremd-Angriffen noch existieren").toBe(200);
  const body = (await res.json()) as ShiftRow;
  expect(body.id).toBe(pShiftId);
  expect(
    body.startTime,
    "startTime darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(P_START);
  expect(
    body.endTime,
    "endTime darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(P_END);
  expect(
    body.planningStatus,
    "planningStatus darf durch den fremden FIX-Versuch nicht veraendert sein",
  ).toBe(pPlanningStatus);
});

test("Positivkontrolle: Admin P kann die eigene Schicht aendern (200)", async () => {
  const res = await employerP.ctx.patch(`/api/shifts/${pShiftId}`, {
    data: { startTime: `${DAY}T09:00:00.000Z`, endTime: `${DAY}T17:00:00.000Z` },
  });
  expect(res.status(), "Eigene Schicht muss per PATCH aenderbar sein").toBe(200);
  const body = (await res.json()) as ShiftRow;
  expect(body.startTime, "PATCH muss den neuen Wert persistieren").toBe(
    `${DAY}T09:00:00.000Z`,
  );
});

test("Positivkontrolle: Admin Q kann die eigene Schicht aendern (404 lag am Scope)", async () => {
  const res = await employerQ.ctx.patch(`/api/shifts/${qShiftId}`, {
    data: { planningStatus: "FIX", force: true },
  });
  expect(res.status(), "Eigene Schicht von Q muss per PATCH aenderbar sein").toBe(200);
  const body = (await res.json()) as ShiftRow;
  expect(body.planningStatus, "PATCH muss den neuen Status persistieren").toBe("FIX");
});
