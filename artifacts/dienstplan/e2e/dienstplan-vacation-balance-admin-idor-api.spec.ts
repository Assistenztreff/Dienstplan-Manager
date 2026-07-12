import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test (Task #405): Admin-Seite des Resturlaub-Bilanz-Endpunkts
 * `GET /contracts/:id/vacation-balance`.
 *
 * Die Assistenten-Seite ist bereits abgesichert
 * (dienstplan-vacation-balance-assistent-idor-api.spec.ts). Hier geht es um die
 * Tenant-Grenze zwischen zwei ARBEITGEBER-Konten: Ein Admin Q darf die Bilanz
 * eines Vertrags aus Konto P (fremder Tenant) NIEMALS abrufen — laut
 * Team-Scoping-Invariante muss das 404 liefern (kein 403, damit die Existenz
 * fremder Vertrags-IDs nicht bestaetigt wird). Eine Regression (z. B. Wegfall
 * des `teamId ∈ allowedTeams`-Checks beim Laden des Vertrags) wuerde
 * Urlaubsdaten fremder Tenants leaken.
 *
 * Aufbau:
 * - Premium-Arbeitgeber P (privat) mit Assistent + Vertrag im Standard-Team.
 * - Zweiter, komplett getrennter Premium-Arbeitgeber Q (privat) mit eigenem
 *   Assistenten + Vertrag (Positivkontrolle fuer Q).
 *
 * Geprueft (Done-Kriterien):
 * 1. Admin P → Vertrag im EIGENEN Team: 200 (Positivkontrolle).
 * 2. Admin Q → Vertrag aus Konto P: 404, keine Bilanz-Daten im Body.
 * 3. Admin Q → EIGENER Vertrag: 200 (belegt, dass die 404 am Scope liegt,
 *    nicht an einem generellen Defekt der Q-Session).
 *
 * Laeuft rein ueber die API gegen den isolierten Test-Stack.
 */

type VacationBalance = { contractId: number; userId: number };

let employerP: FreeAccount;
let employerQ: FreeAccount;

let pContractId = 0;
let qContractId = 0;

async function createAssistant(acc: FreeAccount, label: string): Promise<number> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E AdminVacIdor ${label} ${unique}`,
      email: `e2e.adminvacidor.${label}.${unique}@dienstplan.test`,
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
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(res.status(), "Vertrag anlegen sollte 201 liefern").toBe(201);
  return ((await res.json()) as { id: number }).id;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);

  // --- Arbeitgeber P (Premium) mit Assistent + Vertrag ----------------------
  employerP = await registerFreeAccount("privat", "adminvacidor-p");
  await setAccountPlan(employerP.email, "premium");
  const pAssistantId = await createAssistant(employerP, "p");
  pContractId = await createContract(employerP, pAssistantId);

  // --- Getrennter Arbeitgeber Q (Premium) mit eigenem Assistent + Vertrag ---
  employerQ = await registerFreeAccount("privat", "adminvacidor-q");
  await setAccountPlan(employerQ.email, "premium");
  const qAssistantId = await createAssistant(employerQ, "q");
  qContractId = await createContract(employerQ, qAssistantId);
});

test.afterAll(async () => {
  await deleteFreeAccount(employerP);
  await deleteFreeAccount(employerQ);
});

test("Admin P bekommt 200 fuer den Vertrag im eigenen Team (Positivkontrolle)", async () => {
  const res = await employerP.ctx.get(`/api/contracts/${pContractId}/vacation-balance`);
  expect(res.status(), "Eigener Vertrag muss 200 liefern").toBe(200);
  const body = (await res.json()) as VacationBalance;
  expect(body.contractId, "Body muss den angefragten Vertrag betreffen").toBe(pContractId);
});

test("Admin Q bekommt 404 fuer einen Vertrag aus einem fremden Konto (kein Tenant-Leak)", async () => {
  const res = await employerQ.ctx.get(`/api/contracts/${pContractId}/vacation-balance`);
  expect(
    res.status(),
    "SICHERHEIT: Fremder Tenant-Vertrag muss 404 liefern (Team-Scoping-Invariante)",
  ).toBe(404);
  const body = await res.text();
  expect(body, "404-Antwort darf keine Bilanz-Daten enthalten").not.toContain("vacationDays");
  expect(body, "404-Antwort darf keine Bilanz-Daten enthalten").not.toContain("vacationHours");
});

test("Admin Q bekommt 200 fuer den eigenen Vertrag (404 lag am Scope, nicht an der Session)", async () => {
  const res = await employerQ.ctx.get(`/api/contracts/${qContractId}/vacation-balance`);
  expect(res.status(), "Eigener Vertrag von Q muss 200 liefern").toBe(200);
  const body = (await res.json()) as VacationBalance;
  expect(body.contractId, "Body muss den angefragten Vertrag betreffen").toBe(qContractId);
});
