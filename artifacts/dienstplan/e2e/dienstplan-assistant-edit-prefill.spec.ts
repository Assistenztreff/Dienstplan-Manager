import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test: Der Bearbeiten-Dialog unter "Assistenten" zeigt immer die Daten der
 * tatsächlich angeklickten Karte — nicht die einer zuvor geöffneten.
 *
 * Regressionsschutz für Task #138/#139: Der Dialog wird per `key={editUser?.id}`
 * (bzw. dialogOpenToken) neu gemountet, damit kein Stale-State der zuerst
 * geöffneten Karte hängen bleibt. Ohne Remount würde der Dialog beim Öffnen von
 * Assistent B noch die vorbelegten Felder von Assistent A zeigen — und beim
 * Speichern fälschlich die Personendaten der falschen Person überschreiben.
 *
 * Deckt ab:
 * - Bearbeiten von Assistent A öffnen -> Name/E-Mail/Telefon/Adresse +
 *   Vertragsdaten (Wochenstunden/Urlaub) passen zu A.
 * - Ohne Reload Bearbeiten von Assistent B öffnen -> alle Felder zeigen jetzt B
 *   (kein Stale-State von A).
 * - "Neu anlegen" zeigt ein leeres Formular (Default-Werte, keine A-/B-Daten).
 *
 * Im Dev-Modus meldet die App sich automatisch als Admin an
 * (`/api/auth/dev-login`); das Login-Formular erscheint dann gar nicht. Als
 * Fallback (Prod-Build) wird das Formular ausgefüllt.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: die Assistenten-Karten samt "Bearbeiten" sind hier stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Cold-Start (Login + Navigation) kann das 30s-Default überschreiten.
test.setTimeout(60000);

type CreatedUser = { id: number; name: string; email: string };

interface AssistantFixture {
  id: number;
  vorname: string;
  nachname: string;
  email: string;
  phone: string;
  address: string;
  weeklyHours: number;
  vacationDays: number;
}

let adminCtx: APIRequestContext;
let assistantA: AssistantFixture;
let assistantB: AssistantFixture;

async function createAssistant(
  ctx: APIRequestContext,
  data: Omit<AssistantFixture, "id">,
): Promise<number> {
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
  const user = (await userRes.json()) as CreatedUser;

  const contractRes = await ctx.post("/api/contracts", {
    data: {
      userId: user.id,
      startDate: "2026-01-01",
      weeklyHours: data.weeklyHours,
      vacationDays: data.vacationDays,
    },
  });
  expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(true);

  return user.id;
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

/** Öffnet den Bearbeiten-Dialog der Karte mit der gegebenen userId. */
async function openEditDialog(page: Page, userId: number) {
  const card = page.getByTestId(`assistant-card-${userId}`);
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Assistenten bearbeiten")).toBeVisible();
  return dialog;
}

/** Prüft, dass alle Formularfelder zu der erwarteten Assistenzkraft passen. */
async function expectDialogShows(
  dialog: ReturnType<Page["getByRole"]>,
  a: AssistantFixture,
): Promise<void> {
  await expect(dialog.getByPlaceholder("Max", { exact: true })).toHaveValue(a.vorname);
  await expect(dialog.getByPlaceholder("Mustermann")).toHaveValue(a.nachname);
  await expect(dialog.getByPlaceholder("max@example.de")).toHaveValue(a.email);
  await expect(dialog.getByPlaceholder("0171-1234567")).toHaveValue(a.phone);
  await expect(
    dialog.getByPlaceholder("Musterstr. 1, 12345 Musterstadt"),
  ).toHaveValue(a.address);
  // Wochenstunden (number, max=40) und Urlaubsanspruch (number, max=365).
  await expect(dialog.locator('input[max="40"]')).toHaveValue(String(a.weeklyHours));
  await expect(dialog.locator('input[max="365"]')).toHaveValue(String(a.vacationDays));
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const aData: Omit<AssistantFixture, "id"> = {
    vorname: "Anna",
    nachname: `Alpha${unique}`,
    email: `e2e.edit.a.${unique}@dienstplan.test`,
    phone: "0111-1111111",
    address: "Alphastr. 1, 11111 Alphastadt",
    weeklyHours: 15,
    vacationDays: 25,
  };
  const bData: Omit<AssistantFixture, "id"> = {
    vorname: "Bert",
    nachname: `Beta${unique}`,
    email: `e2e.edit.b.${unique}@dienstplan.test`,
    phone: "0222-2222222",
    address: "Betastr. 2, 22222 Betastadt",
    weeklyHours: 38,
    vacationDays: 28,
  };

  assistantA = { ...aData, id: await createAssistant(adminCtx, aData) };
  assistantB = { ...bData, id: await createAssistant(adminCtx, bData) };
});

test.afterAll(async () => {
  if (assistantA) await adminCtx.delete(`/api/users/${assistantA.id}`);
  if (assistantB) await adminCtx.delete(`/api/users/${assistantB.id}`);
  await adminCtx.dispose();
});

test.describe("AssistentDialog: Bearbeiten zeigt immer die angeklickte Person", () => {
  test("kein Stale-State zwischen Assistent A und B", async ({ page }) => {
    await gotoAssistentenAsAdmin(page);

    // --- Assistent A bearbeiten: Felder müssen zu A passen ------------------
    const dialogA = await openEditDialog(page, assistantA.id);
    await expectDialogShows(dialogA, assistantA);
    await dialogA.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // --- Ohne Reload Assistent B bearbeiten: jetzt müssen alle Felder zu B
    //     passen (kein hängengebliebener Stale-State von A) ------------------
    const dialogB = await openEditDialog(page, assistantB.id);
    await expectDialogShows(dialogB, assistantB);
    await dialogB.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // --- Gegenprobe: erneut A öffnen, weiterhin A-Daten --------------------
    const dialogA2 = await openEditDialog(page, assistantA.id);
    await expectDialogShows(dialogA2, assistantA);
    await dialogA2.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("'Neu anlegen' zeigt ein leeres Formular", async ({ page }) => {
    await gotoAssistentenAsAdmin(page);

    // Erst einen bestehenden Assistenten öffnen, damit ein etwaiger Stale-State
    // existieren würde, dann schließen ...
    const dialogA = await openEditDialog(page, assistantA.id);
    await dialogA.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // ... und das Neu-Anlegen-Formular öffnen: leer / Default-Werte.
    await page.getByRole("button", { name: "Neu anlegen" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Neuen Assistenten anlegen")).toBeVisible();

    await expect(dialog.getByPlaceholder("Max", { exact: true })).toHaveValue("");
    await expect(dialog.getByPlaceholder("Mustermann")).toHaveValue("");
    await expect(dialog.getByPlaceholder("max@example.de")).toHaveValue("");
    await expect(dialog.getByPlaceholder("0171-1234567")).toHaveValue("");
    await expect(
      dialog.getByPlaceholder("Musterstr. 1, 12345 Musterstadt"),
    ).toHaveValue("");
    // Default-Werte des leeren Formulars (EMPTY_FORM).
    await expect(dialog.locator('input[max="40"]')).toHaveValue("20");
    await expect(dialog.locator('input[max="365"]')).toHaveValue("30");
  });
});
