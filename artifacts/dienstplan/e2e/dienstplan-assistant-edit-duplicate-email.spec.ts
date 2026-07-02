import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test: Doppelte E-Mail beim Bearbeiten zeigt eine verständliche Meldung
 * statt still zu scheitern.
 *
 * Ergänzt `dienstplan-assistant-edit-save-correct-person.spec.ts` (Erfolgsfall)
 * um den Kollisionsfall: Wird beim Bearbeiten von Assistent B dessen E-Mail
 * auf die bereits vergebene Adresse von Assistent A geändert, muss der Server
 * mit 409 antworten und der Dialog eine lesbare Fehlermeldung anzeigen —
 * statt still nichts zu speichern oder den Dialog kommentarlos zu schließen.
 *
 * Ablauf:
 * - Assistent A und B (jeweils mit Vertrag) per API anlegen.
 * - Bearbeiten von B öffnen, E-Mail auf A's Adresse setzen, speichern.
 * - Der Dialog bleibt offen und zeigt die Kollisionsmeldung.
 * - Per API verifiziert: weder A noch B (User + Vertrag) wurden verändert.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: die Assistenten-Karten samt "Bearbeiten" sind hier stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Cold-Start (Login + Navigation) kann das 30s-Default überschreiten.
test.setTimeout(60000);

interface AssistantFixture {
  id: number;
  contractId: number;
  vorname: string;
  nachname: string;
  email: string;
  phone: string;
  address: string;
  weeklyHours: number;
  vacationDays: number;
}

interface UserResponse {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
}

interface ContractResponse {
  id: number;
  userId: number;
  weeklyHours: number;
  vacationDays: number;
}

let adminCtx: APIRequestContext;
let assistantA: AssistantFixture;
let assistantB: AssistantFixture;

async function createAssistant(
  ctx: APIRequestContext,
  data: Omit<AssistantFixture, "id" | "contractId">,
): Promise<{ id: number; contractId: number }> {
  const userRes = await ctx.post("/api/users", {
    data: {
      name: `${data.vorname} ${data.nachname}`,
      email: data.email,
      role: "assistant",
      phone: data.phone,
      address: data.address,
    },
  });
  expect(userRes.ok(), `Anlegen des Assistenten fehlgeschlagen (${userRes.status()})`).toBe(true);
  const user = (await userRes.json()) as UserResponse;

  const contractRes = await ctx.post("/api/contracts", {
    data: {
      userId: user.id,
      startDate: "2026-01-01",
      weeklyHours: data.weeklyHours,
      vacationDays: data.vacationDays,
    },
  });
  expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(true);
  const contract = (await contractRes.json()) as ContractResponse;

  return { id: user.id, contractId: contract.id };
}

async function fetchUser(ctx: APIRequestContext, id: number): Promise<UserResponse> {
  const res = await ctx.get(`/api/users/${id}`);
  expect(res.ok(), `GET /api/users/${id} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as UserResponse;
}

async function fetchContract(
  ctx: APIRequestContext,
  contractId: number,
): Promise<ContractResponse> {
  const res = await ctx.get(`/api/contracts/${contractId}`);
  expect(res.ok(), `GET /api/contracts/${contractId} fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as ContractResponse;
}

async function gotoAssistentenAsAdmin(page: Page): Promise<void> {
  const loginRes = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), `Admin-Login fehlgeschlagen (${loginRes.status()})`).toBe(true);
  await page.goto("/assistenten");
  await expect(
    page.getByRole("heading", { name: "Assistenten", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

/** Öffnet den Bearbeiten-Dialog der Karte mit der gegebenen userId. */
async function openEditDialog(page: Page, userId: number) {
  const card = page.getByTestId(`assistant-card-${userId}`);
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Assistenten bearbeiten")).toBeVisible();
  return dialog;
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const aData: Omit<AssistantFixture, "id" | "contractId"> = {
    vorname: "Doris",
    nachname: `DupAlpha${unique}`,
    email: `e2e.dup.a.${unique}@dienstplan.test`,
    phone: "0444-4444444",
    address: "Dupstr. 4, 44444 Dupstadt",
    weeklyHours: 20,
    vacationDays: 26,
  };
  const bData: Omit<AssistantFixture, "id" | "contractId"> = {
    vorname: "Emil",
    nachname: `DupBeta${unique}`,
    email: `e2e.dup.b.${unique}@dienstplan.test`,
    phone: "0555-5555555",
    address: "Dupweg 5, 55555 Dupdorf",
    weeklyHours: 35,
    vacationDays: 30,
  };

  assistantA = { ...aData, ...(await createAssistant(adminCtx, aData)) };
  assistantB = { ...bData, ...(await createAssistant(adminCtx, bData)) };
});

test.afterAll(async () => {
  if (assistantA) await adminCtx.delete(`/api/users/${assistantA.id}`);
  if (assistantB) await adminCtx.delete(`/api/users/${assistantB.id}`);
  await adminCtx.dispose();
});

test.describe("AssistentDialog: Doppelte E-Mail beim Bearbeiten", () => {
  test("409 vom Server → Dialog bleibt offen mit lesbarer Meldung, DB unverändert", async ({
    page,
  }) => {
    await gotoAssistentenAsAdmin(page);

    // DB-Zustand VOR dem Speicherversuch festhalten (Vergleichsbasis).
    const userABefore = await fetchUser(adminCtx, assistantA.id);
    const contractABefore = await fetchContract(adminCtx, assistantA.contractId);
    const userBBefore = await fetchUser(adminCtx, assistantB.id);
    const contractBBefore = await fetchContract(adminCtx, assistantB.contractId);

    // --- B öffnen und dessen E-Mail auf A's (vergebene) Adresse setzen ------
    const dialogB = await openEditDialog(page, assistantB.id);
    await expect(dialogB.getByPlaceholder("max@example.de")).toHaveValue(assistantB.email);

    await dialogB.getByPlaceholder("max@example.de").fill(assistantA.email);

    // Die 409-Antwort des PATCH abfangen, um den Serverstatus zu verifizieren.
    const patchResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/users/${assistantB.id}`) &&
        res.request().method() === "PATCH",
      { timeout: 15000 },
    );

    await dialogB.getByRole("button", { name: "Speichern", exact: true }).click();

    const patchResponse = await patchResponsePromise;
    expect(patchResponse.status(), "Server muss die Kollision mit 409 melden").toBe(409);

    // --- Dialog bleibt offen und zeigt eine verständliche Meldung -----------
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      dialogB.getByText("Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet."),
    ).toBeVisible();

    // Kein stilles Schließen: auch nach kurzer Wartezeit bleibt der Dialog offen.
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(1);

    // --- Verifikation direkt gegen die API/DB: nichts wurde verändert -------
    const userAAfter = await fetchUser(adminCtx, assistantA.id);
    expect(userAAfter).toEqual(userABefore);
    expect(userAAfter.email).toBe(assistantA.email);

    const userBAfter = await fetchUser(adminCtx, assistantB.id);
    expect(userBAfter).toEqual(userBBefore);
    expect(userBAfter.email).toBe(assistantB.email);

    const contractAAfter = await fetchContract(adminCtx, assistantA.contractId);
    expect(contractAAfter).toEqual(contractABefore);

    const contractBAfter = await fetchContract(adminCtx, assistantB.contractId);
    expect(contractBAfter).toEqual(contractBBefore);

    // Aufräumen im UI: Dialog schließen, damit afterAll sauber löschen kann.
    await dialogB.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
