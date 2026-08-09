import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test: Beim Bearbeiten und Speichern landen die Daten wirklich bei der
 * angeklickten Person — und NUR bei ihr.
 *
 * Ergänzt `dienstplan-assistant-edit-prefill.spec.ts` (das nur die Vorbelegung
 * des Dialogs prüft) um den eigentlichen Gefahrenfall aus Task #138/#139:
 * Nach dem Ändern eines Feldes und Klick auf "Speichern" dürfen die neuen
 * Werte ausschließlich in der DB-Zeile der bearbeiteten Person landen. Eine
 * andere (zuvor geöffnete) Person darf dabei NICHT verändert werden.
 *
 * Ablauf:
 * - Assistent A und B (jeweils mit Vertrag) per API anlegen.
 * - Erst Bearbeiten von A öffnen und wieder schließen (provoziert etwaigen
 *   Stale-State), dann Bearbeiten von B öffnen.
 * - Telefon, Adresse und Wochenstunden von B ändern und speichern.
 * - Per API (`GET /api/users/:id`, `GET /api/contracts?userId=...`)
 *   verifizieren: B trägt exakt die neuen Werte, A ist bit für bit unverändert.
 *
 * Login erfolgt programmatisch über die API (page.request teilt den
 * Cookie-Jar mit dem Browser) — dev- und prod-tauglich.
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
  await page.goto("/team-verwaltung");
  await expect(
    page.getByRole("heading", { name: "Team-Verwaltung", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

/** Öffnet den Bearbeiten-Dialog der Karte mit der gegebenen userId. */
async function openEditDialog(page: Page, userId: number) {
  const card = page.getByTestId(`assistant-card-${userId}`);
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Assistenzkraft bearbeiten")).toBeVisible();
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
    vorname: "Alma",
    nachname: `SaveAlpha${unique}`,
    email: `e2e.save.a.${unique}@dienstplan.test`,
    phone: "0111-1111111",
    address: "Alphastr. 1, 11111 Alphastadt",
    weeklyHours: 15,
    vacationDays: 25,
  };
  const bData: Omit<AssistantFixture, "id" | "contractId"> = {
    vorname: "Bruno",
    nachname: `SaveBeta${unique}`,
    email: `e2e.save.b.${unique}@dienstplan.test`,
    phone: "0222-2222222",
    address: "Betastr. 2, 22222 Betastadt",
    weeklyHours: 38,
    vacationDays: 28,
  };

  assistantA = { ...aData, ...(await createAssistant(adminCtx, aData)) };
  assistantB = { ...bData, ...(await createAssistant(adminCtx, bData)) };
});

test.afterAll(async () => {
  if (assistantA) await adminCtx.delete(`/api/users/${assistantA.id}`);
  if (assistantB) await adminCtx.delete(`/api/users/${assistantB.id}`);
  await adminCtx.dispose();
});

test.describe("AssistentDialog: Speichern trifft nur die bearbeitete Person", () => {
  test("Änderungen an B landen bei B — A bleibt in der DB unverändert", async ({ page }) => {
    await gotoAssistentenAsAdmin(page);

    // DB-Zustand von A VOR der Bearbeitung festhalten (Vergleichsbasis).
    const userABefore = await fetchUser(adminCtx, assistantA.id);
    const contractABefore = await fetchContract(adminCtx, assistantA.contractId);

    // --- Stale-State provozieren: erst A öffnen und wieder schließen --------
    const dialogA = await openEditDialog(page, assistantA.id);
    await dialogA.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // --- Dann B öffnen, Felder ändern und speichern -------------------------
    const dialogB = await openEditDialog(page, assistantB.id);

    // Sicherstellen, dass wirklich B's Daten vorbelegt sind (sonst würden wir
    // gleich die falsche Person überschreiben — genau der Bug aus #138/#139).
    await expect(dialogB.getByPlaceholder("max@example.de")).toHaveValue(assistantB.email);

    const newPhone = "0333-3333333";
    const newAddress = "Neue Str. 3, 33333 Neustadt";
    const newWeeklyHours = 30;

    await dialogB.getByPlaceholder("0171-1234567").fill(newPhone);
    await dialogB.getByPlaceholder("Musterstr. 1, 12345 Musterstadt").fill(newAddress);
    await dialogB.locator('input[max="40"]').fill(String(newWeeklyHours));

    await dialogB.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15000 });

    // --- Verifikation direkt gegen die API/DB -------------------------------
    // B trägt exakt die neuen Werte; Name/E-Mail unverändert.
    const userBAfter = await fetchUser(adminCtx, assistantB.id);
    expect(userBAfter.phone).toBe(newPhone);
    expect(userBAfter.address).toBe(newAddress);
    expect(userBAfter.name).toBe(`${assistantB.vorname} ${assistantB.nachname}`);
    expect(userBAfter.email).toBe(assistantB.email);

    const contractBAfter = await fetchContract(adminCtx, assistantB.contractId);
    expect(contractBAfter.userId).toBe(assistantB.id);
    expect(contractBAfter.weeklyHours).toBe(newWeeklyHours);
    expect(contractBAfter.vacationDays).toBe(assistantB.vacationDays);

    // A ist vollständig unverändert (kein stiller Überschreiber).
    const userAAfter = await fetchUser(adminCtx, assistantA.id);
    expect(userAAfter).toEqual(userABefore);
    expect(userAAfter.phone).toBe(assistantA.phone);
    expect(userAAfter.address).toBe(assistantA.address);
    expect(userAAfter.name).toBe(`${assistantA.vorname} ${assistantA.nachname}`);
    expect(userAAfter.email).toBe(assistantA.email);

    const contractAAfter = await fetchContract(adminCtx, assistantA.contractId);
    expect(contractAAfter).toEqual(contractABefore);
    expect(contractAAfter.weeklyHours).toBe(assistantA.weeklyHours);
    expect(contractAAfter.vacationDays).toBe(assistantA.vacationDays);
  });
});
