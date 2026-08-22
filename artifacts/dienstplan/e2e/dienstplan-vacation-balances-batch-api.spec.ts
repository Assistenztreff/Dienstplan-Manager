import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import {
  TeamTestHarness,
  BASE_URL,
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * API-Beweis (Task #871, Paket C): GET /api/vacation-balances ersetzt die
 * frueher pro Assistenzkraft abgesetzten Einzelaufrufe
 * (GET /contracts/:id/vacation-balance) durch EINEN Sammel-Request, ohne die
 * Team-/Rollen-Scoping-Regeln der Einzel-Route zu verwässern.
 *
 * Abgesichert wird:
 * - Parität: jede Zeile der Sammel-Antwort ist Feld für Feld identisch zum
 *   entsprechenden Einzelaufruf — die Extraktion der gemeinsamen
 *   Rechenfunktion (computeVacationBalanceForContract) darf das Ergebnis
 *   nicht verändert haben.
 * - Assistenten-Scoping: ein Assistent bekommt über den Sammel-Endpunkt NUR
 *   den eigenen Vertrag zurück, nie den seines Team-Kollegen.
 * - Tenant-Grenze: teamId eines fremden Kontos liefert 404 (kein
 *   Existenz-Leak), identisch zur Einzel-Route.
 */

let h: TeamTestHarness;
let teamA: number;
let assistant1: number;
let assistant2: number;
let contract1Id: number;
let contract2Id: number;

let foreignEmployer: FreeAccount | undefined;
let assistantCtx: APIRequestContext | undefined;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();

  teamA = await h.createTeam("E2E VacBatch Team A");
  assistant1 = await h.createUser({ teamId: teamA, role: "assistant" });
  assistant2 = await h.createUser({ teamId: teamA, role: "assistant" });

  contract1Id = await h.createContract(teamA, assistant1, { vacationDays: 30, weeklyHours: 40 });
  contract2Id = await h.createContract(teamA, assistant2, { vacationDays: 20, weeklyHours: 20 });

  // Assistenten-Session über den Einladungsflow (siehe Memory
  // e2e-assistant-login-via-invite). h ist über becomeDienstleister() bereits
  // Premium (nötig für den Sammel-Endpunkt selbst, absenceTracking) — hier
  // nur die Einladung auslösen, Plan bleibt unverändert Premium.
  const inviteRes = await h.ctx.post(`/api/users/${assistant1}/invite`);
  expect(inviteRes.ok(), `Einladung fehlgeschlagen (${inviteRes.status()})`).toBe(true);
  const { token } = (await inviteRes.json()) as { token: string };

  assistantCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const setPwRes = await assistantCtx.post("/api/auth/set-password", {
    data: { token, password: "assistent12345" },
  });
  expect(setPwRes.ok(), `Passwort setzen fehlgeschlagen (${setPwRes.status()})`).toBe(true);

  foreignEmployer = await registerFreeAccount("privat", "vacbatch-foreign");
  await setAccountPlan(foreignEmployer.email, "premium");
});

test.afterAll(async () => {
  await h.cleanup();
  await deleteFreeAccount(foreignEmployer);
  await assistantCtx?.dispose();
});

test("Sammel-Antwort enthält beide Verträge und stimmt Feld für Feld mit den Einzelaufrufen überein", async () => {
  const batchRes = await h.ctx.get(`/api/vacation-balances?teamId=${teamA}`);
  expect(batchRes.ok(), `Sammel-Endpunkt fehlgeschlagen (${batchRes.status()})`).toBe(true);
  const batch = (await batchRes.json()) as Array<Record<string, unknown>>;
  expect(batch.length, "Sammel-Antwort muss beide Verträge enthalten").toBe(2);

  for (const contractId of [contract1Id, contract2Id]) {
    const singleRes = await h.ctx.get(`/api/contracts/${contractId}/vacation-balance`);
    expect(singleRes.ok(), `Einzelaufruf fehlgeschlagen (${singleRes.status()})`).toBe(true);
    const single = (await singleRes.json()) as Record<string, unknown>;
    const row = batch.find((r) => r.contractId === contractId);
    expect(row, `Vertrag ${contractId} fehlt in der Sammel-Antwort`).toBeTruthy();
    expect(row, "Sammel-Zeile muss dem Einzelaufruf entsprechen").toEqual(single);
  }
});

test("Assistent bekommt über den Sammel-Endpunkt NUR den eigenen Vertrag", async () => {
  if (!assistantCtx) throw new Error("Assistenten-Kontext nicht initialisiert");
  const res = await assistantCtx.get(`/api/vacation-balances?teamId=${teamA}`);
  expect(res.ok(), `Sammel-Endpunkt (Assistent) fehlgeschlagen (${res.status()})`).toBe(true);
  const rows = (await res.json()) as Array<{ contractId: number; userId: number }>;
  expect(rows.map((r) => r.contractId)).toEqual([contract1Id]);
  expect(rows.every((r) => r.userId === assistant1)).toBe(true);
});

test("Fremdes Team liefert 404 (kein Tenant-Leak über den Sammel-Endpunkt)", async () => {
  if (!foreignEmployer) throw new Error("Fremd-Konto nicht initialisiert");
  const res = await foreignEmployer.ctx.get(`/api/vacation-balances?teamId=${teamA}`);
  expect(res.status(), "Fremdes Team muss 404 liefern").toBe(404);
});
