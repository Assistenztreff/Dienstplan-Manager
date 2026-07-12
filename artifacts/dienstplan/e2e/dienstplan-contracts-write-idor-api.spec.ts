import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test (Task #420): SCHREIB-Seite des Vertrags-Endpunkts —
 * `PATCH /contracts/:id` und `DELETE /contracts/:id`.
 *
 * Die Lese-Seite ist bereits beidseitig abgesichert
 * (dienstplan-vacation-balance-assistent-idor-api.spec.ts fuer Assistenten,
 * dienstplan-vacation-balance-admin-idor-api.spec.ts fuer Admins). Hier geht es
 * um die Tenant-Grenze beim SCHREIBEN: Ein Admin Q darf einen Vertrag aus
 * Konto P (fremder Tenant) weder aendern noch loeschen — laut
 * Team-Scoping-Invariante muss beides 404 liefern (kein 403, damit die
 * Existenz fremder Vertrags-IDs nicht bestaetigt wird). Eine Regression
 * (z. B. Wegfall des `teamId ∈ allowedTeams`-Checks im UPDATE/DELETE-WHERE)
 * wuerde es einem Arbeitgeber erlauben, Wochenstunden/Urlaubstage fremder
 * Konten zu manipulieren oder Vertraege zu loeschen.
 *
 * Aufbau:
 * - Arbeitgeber P (privat) mit Assistent + Vertrag im Standard-Team.
 * - Zweiter, komplett getrennter Arbeitgeber Q (privat) mit eigenem
 *   Assistenten + Vertrag (Positivkontrolle fuer die Q-Session).
 *   Vertrags-CRUD ist nicht plan-gegated, Free-Konten genuegen.
 *
 * Geprueft (Done-Kriterien):
 * 1. Admin Q → PATCH auf den P-Vertrag (weeklyHours): 404.
 * 2. Admin Q → DELETE auf den P-Vertrag: 404.
 * 3. Nachkontrolle ueber P: GET liefert den Vertrag UNVERAENDERT
 *    (weeklyHours/vacationDays wie beim Anlegen, Vertrag existiert noch).
 * 4. Positivkontrolle: P kann den EIGENEN Vertrag aendern (200).
 * 5. Positivkontrolle: Q kann den EIGENEN Vertrag aendern (200) — belegt,
 *    dass die 404 am Scope lag, nicht an einem Defekt der Q-Session.
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type ContractRow = { id: number; weeklyHours: number; vacationDays: number };

const P_WEEKLY_HOURS = 40;
const P_VACATION_DAYS = 30;

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pContractId = 0;
let qContractId = 0;

async function createAssistant(acc: FreeAccount, label: string): Promise<number> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E ContractWriteIdor ${label} ${unique}`,
      email: `e2e.contractwriteidor.${label}.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.status(), `Assistent (${label}) anlegen sollte 201 liefern`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

async function createContract(acc: FreeAccount, userId: number): Promise<number> {
  const res = await acc.ctx.post("/api/contracts", {
    data: {
      userId,
      startDate: "2026-01-01",
      weeklyHours: P_WEEKLY_HOURS,
      vacationDays: P_VACATION_DAYS,
    },
  });
  expect(res.status(), "Vertrag anlegen sollte 201 liefern").toBe(201);
  return ((await res.json()) as { id: number }).id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);

  // --- Arbeitgeber P mit Assistent + Vertrag --------------------------------
  employerP = await registerFreeAccount("privat", "contractwriteidor-p");
  const pAssistantId = await createAssistant(employerP, "p");
  pContractId = await createContract(employerP, pAssistantId);

  // --- Getrennter Arbeitgeber Q mit eigenem Assistent + Vertrag -------------
  employerQ = await registerFreeAccount("privat", "contractwriteidor-q");
  const qAssistantId = await createAssistant(employerQ, "q");
  qContractId = await createContract(employerQ, qAssistantId);
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("Admin Q bekommt 404 beim PATCH auf einen fremden Vertrag", async () => {
  const res = await employerQ.ctx.patch(`/api/contracts/${pContractId}`, {
    data: { weeklyHours: 10 },
  });
  expect(
    res.status(),
    "SICHERHEIT: PATCH auf fremden Tenant-Vertrag muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
  const body = await res.text();
  expect(body, "404-Antwort darf keine Vertragsdaten enthalten").not.toContain("weeklyHours");
});

test("Admin Q bekommt 404 beim DELETE auf einen fremden Vertrag", async () => {
  const res = await employerQ.ctx.delete(`/api/contracts/${pContractId}`);
  expect(
    res.status(),
    "SICHERHEIT: DELETE auf fremden Tenant-Vertrag muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
});

test("Nachkontrolle P: Vertrag existiert unveraendert weiter", async () => {
  const res = await employerP.ctx.get(`/api/contracts/${pContractId}`);
  expect(res.status(), "P-Vertrag muss nach den Fremd-Angriffen noch existieren").toBe(200);
  const body = (await res.json()) as ContractRow;
  expect(body.id).toBe(pContractId);
  expect(
    body.weeklyHours,
    "weeklyHours darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(P_WEEKLY_HOURS);
  expect(
    body.vacationDays,
    "vacationDays darf durch den fremden PATCH-Versuch nicht veraendert sein",
  ).toBe(P_VACATION_DAYS);
});

test("Positivkontrolle: Admin P kann den eigenen Vertrag aendern (200)", async () => {
  const res = await employerP.ctx.patch(`/api/contracts/${pContractId}`, {
    data: { weeklyHours: 35 },
  });
  expect(res.status(), "Eigener Vertrag muss per PATCH aenderbar sein").toBe(200);
  const body = (await res.json()) as ContractRow;
  expect(body.weeklyHours, "PATCH muss den neuen Wert persistieren").toBe(35);
});

test("Positivkontrolle: Admin Q kann den eigenen Vertrag aendern (404 lag am Scope)", async () => {
  const res = await employerQ.ctx.patch(`/api/contracts/${qContractId}`, {
    data: { weeklyHours: 25 },
  });
  expect(res.status(), "Eigener Vertrag von Q muss per PATCH aenderbar sein").toBe(200);
  const body = (await res.json()) as ContractRow;
  expect(body.weeklyHours, "PATCH muss den neuen Wert persistieren").toBe(25);
});
