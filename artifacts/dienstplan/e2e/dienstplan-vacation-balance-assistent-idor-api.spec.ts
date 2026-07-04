import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import {
  BASE_URL,
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Test (Task #333): Der Resturlaub-Bilanz-Endpunkt
 * `GET /contracts/:id/vacation-balance` ist auch für Assistenten offen
 * (eigener Vertrag, Plan-Gate über den Arbeitgeber). Die kritische
 * Sicherheitsinvariante — ein Assistent darf NIE den Resturlaub eines
 * Team-Kollegen (oder eines fremden Kontos) abrufen — ist bisher nur manuell
 * belegt. Eine Regression (z. B. Wegfall des `contract.userId !==
 * session.userId`-Checks) würde PII (Urlaubsdaten von Kollegen) leaken.
 *
 * Aufbau:
 * - Premium-Arbeitgeber P mit zwei Assistenten A und B (je ein Vertrag) im
 *   Standard-Team. Assistent A wird per Einladungsflow eingeloggt.
 * - Ein zweiter, getrennter Premium-Arbeitgeber Q mit eigenem Assistenten +
 *   Vertrag liefert den "Außenseiter"-Vertrag außerhalb aller Teams von A.
 *
 * Geprüft (Done-Kriterien):
 * 1. Assistent A → EIGENER Vertrag: 200, Body.userId == A.
 * 2. Assistent A → Vertrag des Kollegen B (SELBES Team): 404 (kein PII-Leak).
 * 3. Assistent A → Vertrag außerhalb seiner Teams (Konto Q): 404.
 * 4. Nach Downgrade des Arbeitgebers P auf Free: Assistent A → EIGENER Vertrag
 *    403 `plan_feature_required` (Feature `absenceTracking`), da das Gate am
 *    Plan des Team-Eigentümers hängt.
 *
 * Läuft rein über die API gegen den isolierten Test-Stack.
 */

type VacationBalance = { contractId: number; userId: number };

let employer: FreeAccount;
let outsider: FreeAccount;
let assistantCtx: APIRequestContext | undefined;

let assistantAId = 0;
let ownContractId = 0;
let colleagueContractId = 0;
let outsiderContractId = 0;

async function createAssistant(
  acc: FreeAccount,
  label: string,
): Promise<number> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const res = await acc.ctx.post("/api/users", {
    data: {
      name: `E2E VacIdor ${label} ${unique}`,
      email: `e2e.vacidor.${label}.${unique}@dienstplan.test`,
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

  // --- Arbeitgeber P (Premium) mit zwei Assistenten + Verträgen -------------
  employer = await registerFreeAccount("privat", "vacidor-p");
  setAccountPlan(employer.email, "premium");

  assistantAId = await createAssistant(employer, "a");
  const assistantBId = await createAssistant(employer, "b");
  ownContractId = await createContract(employer, assistantAId);
  colleagueContractId = await createContract(employer, assistantBId);

  // --- Assistent A per Einladungsflow einloggen -----------------------------
  const inviteRes = await employer.ctx.post(`/api/users/${assistantAId}/invite`);
  expect(inviteRes.ok(), `Einladung sollte mit Premium klappen (${inviteRes.status()})`).toBe(true);
  const inviteToken = ((await inviteRes.json()) as { token: string }).token;
  expect(inviteToken, "Einladungs-Token muss geliefert werden").toBeTruthy();

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token: inviteToken, password: "assistent1234" },
  });
  expect(setPwRes.ok(), `set-password sollte 200 liefern (${setPwRes.status()})`).toBe(true);
  const me = await assistantCtx.get("/api/auth/me");
  const meBody = (await me.json()) as { id: number; role: string };
  expect(meBody.id, "Session muss Assistent A sein").toBe(assistantAId);
  expect(meBody.role, "Session muss die Assistenten-Rolle tragen").toBe("assistant");

  // --- Getrennter Arbeitgeber Q (Premium) = Außenseiter-Vertrag -------------
  outsider = await registerFreeAccount("privat", "vacidor-q");
  setAccountPlan(outsider.email, "premium");
  const outsiderAssistantId = await createAssistant(outsider, "q");
  outsiderContractId = await createContract(outsider, outsiderAssistantId);
});

test.afterAll(async () => {
  await deleteFreeAccount(employer);
  await deleteFreeAccount(outsider);
  try {
    await assistantCtx?.dispose();
  } catch {
    /* ignore */
  }
});

test("Assistent bekommt 200 für den EIGENEN Vertrag", async () => {
  const res = await assistantCtx!.get(`/api/contracts/${ownContractId}/vacation-balance`);
  expect(res.status(), "Eigener Vertrag muss 200 liefern").toBe(200);
  const body = (await res.json()) as VacationBalance;
  expect(body.contractId, "Body muss den eigenen Vertrag betreffen").toBe(ownContractId);
  expect(body.userId, "Body muss den eigenen Assistenten betreffen (Identitätsbindung)").toBe(
    assistantAId,
  );
});

test("Assistent bekommt 404 für den Vertrag eines Team-Kollegen (kein PII-Leak)", async () => {
  const res = await assistantCtx!.get(
    `/api/contracts/${colleagueContractId}/vacation-balance`,
  );
  expect(
    res.status(),
    "SICHERHEIT: Kollegen-Vertrag im selben Team muss 404 liefern",
  ).toBe(404);
  const body = await res.text();
  expect(body, "404-Antwort darf keine Bilanz-Daten enthalten").not.toContain("vacationDays");
});

test("Assistent bekommt 404 für einen Vertrag außerhalb seiner Teams", async () => {
  const res = await assistantCtx!.get(
    `/api/contracts/${outsiderContractId}/vacation-balance`,
  );
  expect(
    res.status(),
    "SICHERHEIT: Fremder Vertrag außerhalb der Teams muss 404 liefern",
  ).toBe(404);
});

test("Nach Arbeitgeber-Downgrade auf Free → 403 plan_feature_required für den eigenen Vertrag", async () => {
  // Das Plan-Gate hängt am Team-Eigentümer (Arbeitgeber), nicht am Assistenten.
  setAccountPlan(employer.email, "free");
  try {
    const res = await assistantCtx!.get(`/api/contracts/${ownContractId}/vacation-balance`);
    expect(
      res.status(),
      "Free-Arbeitgeber muss die Bilanz per API sperren (403)",
    ).toBe(403);
    const body = (await res.json()) as { code?: string; feature?: string };
    expect(body.code, "403 muss plan_feature_required tragen").toBe("plan_feature_required");
    expect(body.feature, "403 muss das Feature absenceTracking benennen").toBe("absenceTracking");
  } finally {
    // Premium wiederherstellen, damit das Cleanup (deleteFreeAccount) und
    // etwaige Geschwister-Läufe nicht vom Downgrade beeinflusst werden.
    setAccountPlan(employer.email, "premium");
  }
});
