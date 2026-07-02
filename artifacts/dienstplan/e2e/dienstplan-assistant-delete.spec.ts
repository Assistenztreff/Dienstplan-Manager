import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test für das Löschen einer Assistenzkraft samt zugehöriger Daten.
 *
 * Im Bearbeiten-Dialog der Assistenten gibt es einen Lösch-Knopf mit
 * Sicherheitsabfrage (AlertDialog). Diese kritische, unwiderrufliche Aktion
 * (löscht Nutzer samt Vertrag, Schichten und erfassten Zeiten per DB-Cascade)
 * wird hier automatisiert abgesichert.
 *
 * Deckt ab:
 * - Anlegen einer Test-Assistenzkraft inkl. Vertrag und Schicht (über API)
 * - Öffnen des Bearbeiten-Dialogs, Klick auf "Loeschen", Bestätigen der
 *   Sicherheitsabfrage -> die Karte verschwindet aus der Liste
 * - Backend-Prüfung: GET /api/users liefert die Kraft nicht mehr, ihre Daten
 *   (Vertrag, Schicht) sind ebenfalls weg
 * - Negativfall: beim Neuanlegen erscheint KEIN Lösch-Knopf
 *
 * Im Dev-Modus meldet die App sich automatisch als Admin an
 * (`/api/auth/dev-login`), das Login-Formular erscheint dann gar nicht.
 * Als Fallback (z.B. Prod-Build) wird das Formular ausgefüllt.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: die Assistenten-Karten samt "Bearbeiten" sind hier stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Cold-Start (Login + Navigation) kann das 30s-Default überschreiten.
test.setTimeout(60000);

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number };
type Shift = { id: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number | undefined;
let shiftId: number | undefined;
// Eigene Kraft für den Abbruch-Test, damit der Lösch-Test sie nicht entfernt.
let cancelAssistant: CreatedUser | undefined;

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

async function createAssistant(ctx: APIRequestContext, suffix: string): Promise<CreatedUser> {
  const res = await ctx.post("/api/users", {
    data: {
      name: `E2E Loeschen ${suffix}`,
      email: `e2e.delete.${suffix}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as CreatedUser;
}

async function createContract(ctx: APIRequestContext, userId: number): Promise<number> {
  const res = await ctx.post("/api/contracts", {
    data: {
      userId,
      startDate: `${year}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(res.ok(), `Anlegen des Vertrags fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Contract).id;
}

async function createShift(ctx: APIRequestContext, userId: number): Promise<number> {
  const start = new Date(year, month - 1, 10, 8, 0, 0);
  const end = new Date(year, month - 1, 10, 16, 0, 0);
  const res = await ctx.post("/api/shifts", {
    data: {
      userId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      type: "active",
    },
  });
  expect(res.ok(), `Anlegen der Schicht fehlgeschlagen (${res.status()})`).toBe(true);
  return ((await res.json()) as Shift).id;
}

/**
 * Öffnet die Assistenten-Seite als Admin. Im Dev-Modus erfolgt der Login
 * automatisch; sonst wird das Login-Formular ausgefüllt.
 */
async function gotoAssistentenAsAdmin(page: Page): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
  // der Vite-Dev-Auto-Login greift nie (dev- UND prod-tauglich).
  const loginRes = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), `Admin-Login fehlgeschlagen (${loginRes.status()})`).toBe(true);
  await page.goto("/assistenten");
  await expect(
    page.getByRole("heading", { name: "Assistenten", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  assistant = await createAssistant(adminCtx, `${unique}`);
  contractId = await createContract(adminCtx, assistant.id);
  shiftId = await createShift(adminCtx, assistant.id);
});

test.afterAll(async () => {
  // Falls der Test fehlschlägt und nicht gelöscht hat: best-effort aufräumen.
  if (assistant?.id) {
    await adminCtx.delete(`/api/users/${assistant.id}`).catch(() => {});
  }
  if (cancelAssistant?.id) {
    await adminCtx.delete(`/api/users/${cancelAssistant.id}`).catch(() => {});
  }
  await adminCtx.dispose();
});

test("Abbrechen der Sicherheitsabfrage erhält die Assistenzkraft", async ({
  page,
}) => {
  // Eigene Kraft anlegen, damit der nachfolgende Lösch-Test unbeeinflusst bleibt.
  cancelAssistant = await createAssistant(adminCtx, `cancel-${Date.now()}`);

  await gotoAssistentenAsAdmin(page);

  const card = page.getByTestId(`assistant-card-${cancelAssistant.id}`);
  await expect(card).toBeVisible();

  // Bearbeiten-Dialog öffnen.
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(
    page.getByRole("heading", { name: "Assistenten bearbeiten" }),
  ).toBeVisible();

  // Lösch-Knopf anklicken -> Sicherheitsabfrage erscheint.
  await page.getByRole("button", { name: "Loeschen" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText("Assistenten loeschen?")).toBeVisible();

  // Abbrechen -> nichts wird gelöscht.
  await confirm.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirm).toHaveCount(0);

  // Die Karte steht weiterhin in der Liste.
  await expect(card).toBeVisible();

  // Backend: Nutzer existiert weiterhin.
  const usersRes = await adminCtx.get("/api/users");
  expect(usersRes.ok()).toBe(true);
  const users = (await usersRes.json()) as CreatedUser[];
  expect(users.some((u) => u.id === cancelAssistant!.id)).toBe(true);

  // Aufräumen, damit die Liste sauber bleibt.
  await adminCtx.delete(`/api/users/${cancelAssistant.id}`).catch(() => {});
  cancelAssistant = undefined;
});

test("Assistenzkraft kann samt Daten über den Bearbeiten-Dialog gelöscht werden", async ({
  page,
}) => {
  await gotoAssistentenAsAdmin(page);

  // Die angelegte Kraft ist als Karte sichtbar.
  const card = page.getByTestId(`assistant-card-${assistant.id}`);
  await expect(card).toBeVisible();

  // Bearbeiten-Dialog öffnen.
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(
    page.getByRole("heading", { name: "Assistenten bearbeiten" }),
  ).toBeVisible();

  // Lösch-Knopf im Dialog anklicken -> Sicherheitsabfrage erscheint.
  await page.getByRole("button", { name: "Loeschen" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText("Assistenten loeschen?")).toBeVisible();
  // Der Name der konkreten Kraft taucht in der Warnung auf.
  await expect(confirm).toContainText(assistant.name);

  // Endgültig bestätigen.
  await confirm.getByRole("button", { name: "Endgueltig loeschen" }).click();

  // Die Karte verschwindet aus der Liste.
  await expect(card).toHaveCount(0, { timeout: 15000 });

  // Backend: Nutzer und seine Daten sind weg.
  const usersRes = await adminCtx.get("/api/users");
  expect(usersRes.ok()).toBe(true);
  const users = (await usersRes.json()) as CreatedUser[];
  expect(users.some((u) => u.id === assistant.id)).toBe(false);

  const contractsRes = await adminCtx.get(`/api/contracts?userId=${assistant.id}`);
  if (contractsRes.ok()) {
    const contracts = (await contractsRes.json()) as { userId: number }[];
    expect(contracts.some((c) => c.userId === assistant.id)).toBe(false);
  }

  const shiftsRes = await adminCtx.get(`/api/shifts?userId=${assistant.id}`);
  if (shiftsRes.ok()) {
    const shifts = (await shiftsRes.json()) as { userId: number }[];
    expect(shifts.some((s) => s.userId === assistant.id)).toBe(false);
  }
});

test("beim Neuanlegen erscheint kein Lösch-Knopf", async ({ page }) => {
  await gotoAssistentenAsAdmin(page);

  // Anlege-Dialog öffnen.
  await page.getByRole("button", { name: "Neu anlegen" }).click();
  await expect(
    page.getByRole("heading", { name: "Neuen Assistenten anlegen" }),
  ).toBeVisible();

  // Im Anlege-Modus gibt es keinen "Loeschen"-Knopf.
  await expect(page.getByRole("button", { name: "Loeschen" })).toHaveCount(0);
});
