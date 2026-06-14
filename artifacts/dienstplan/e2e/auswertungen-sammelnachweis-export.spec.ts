import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E-Test für den Sammel-Nachweis-Export auf der Auswertungen-Seite.
 *
 * Anders als der Einzel-Nachweis auf der Assistenten-Seite (Task 61) erzeugt
 * der "Als PDF exportieren"-Button im Auswertungen-Header einen Gesamt-Nachweis
 * für ALLE Assistenten (eine Seite pro Person/Monat). Der Dateiname enthält
 * daher den Platzhalter "Alle" statt eines einzelnen Namens.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent + Vertrag + Schicht im Zielmonat (Vormonat) per API anlegen
 * - Monatsnavigation der Seite (einen Monat zurück), bis Daten erscheinen
 * - Öffnen des Export-Dialogs und Monatsnavigation im Dialog (von/bis zurück)
 * - Der PDF-Export löst einen Download mit dem erwarteten Dateinamen aus:
 *   Stundennachweis_Alle_<Jahr>_<Monat>.pdf
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport hält das Header-Layout (Monatsnavigation + Export-Button) stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Zielmonat = der Vormonat. Sowohl die Seiten- als auch die Dialog-Navigation
// starten beim aktuellen Monat (`new Date()`); ein Klick "zurück" landet hier.
const NOW = new Date();
const TARGET = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1);
const TARGET_MONTH = TARGET.getMonth() + 1;
const TARGET_YEAR = TARGET.getFullYear();
const TARGET_MM = String(TARGET_MONTH).padStart(2, "0");
// Ein Tag mitten im Zielmonat für die Beleg-Schicht.
const SHIFT_DAY = `${TARGET_YEAR}-${TARGET_MM}-15`;

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;
let shiftId: number;

// Gesamt-Nachweis: namePart = "Alle", rangePart = "<Jahr>_<Monat>".
const expectedFilename = `Stundennachweis_Alle_${TARGET_YEAR}_${TARGET_MM}.pdf`;

async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  // Im Dev-Modus meldet die App via /api/auth/dev-login automatisch als Admin
  // an und leitet von /login direkt auf / um – dann erscheint kein Formular.
  // Ist die Auto-Anmeldung nicht aktiv, das Login-Formular regulär ausfüllen.
  const emailField = page.locator("#email");
  try {
    await emailField.waitFor({ state: "visible", timeout: 5000 });
    await emailField.fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Anmelden" }).click();
  } catch {
    // Formular nicht sichtbar -> Auto-Anmeldung greift bereits.
  }
  await expect(page).toHaveURL(/\/$/);
}

test.beforeAll(async () => {
  const unique = Date.now();
  adminCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });

  const loginRes = await adminCtx.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginRes.ok(), "Admin-Login für Setup fehlgeschlagen").toBe(true);

  const userRes = await adminCtx.post("/api/users", {
    data: {
      name: `E2E Sammel ${unique}`,
      email: `e2e.sammel.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen des Assistenten fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistant = (await userRes.json()) as CreatedUser;

  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistant.id,
      startDate: `${TARGET_YEAR}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(
    true
  );
  contractId = ((await contractRes.json()) as Contract).id;

  // Eine Schicht im Zielmonat, damit der Sammel-Nachweis nicht leer ist.
  const shiftRes = await adminCtx.post("/api/shifts", {
    data: {
      userId: assistant.id,
      startTime: `${SHIFT_DAY}T08:00:00.000Z`,
      endTime: `${SHIFT_DAY}T16:00:00.000Z`,
      type: "active",
    },
  });
  expect(shiftRes.ok(), `Anlegen der Schicht fehlgeschlagen (${shiftRes.status()})`).toBe(true);
  shiftId = ((await shiftRes.json()) as { id: number }).id;
});

test.afterAll(async () => {
  if (shiftId) await adminCtx.delete(`/api/shifts/${shiftId}`);
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistant?.id) await adminCtx.delete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test("Auswertungen-Header exportiert den Sammel-Nachweis aller Assistenten mit erwartetem Dateinamen", async ({
  page,
}) => {
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/auswertungen");
  await expect(page.getByRole("heading", { name: "Auswertungen", exact: true })).toBeVisible();

  // Seite startet beim aktuellen Monat; einen Monat zurück in den Zielmonat,
  // bis die Balance-Karte des angelegten Assistenten erscheint.
  await page.getByTestId("month-prev").click();
  await expect(page.getByRole("heading", { name: assistant.name })).toBeVisible();

  // Filter explizit auf "Alle" stellen, damit der Gesamt-Nachweis (namePart
  // "Alle") und nicht ein Einzel-Nachweis erzeugt wird.
  await page.getByTestId("assistant-chip-all").click();

  // Export-Button im Header ist freigeschaltet, sobald Daten geladen sind.
  const exportButton = page.getByTestId("export-pdf-button");
  await expect(exportButton).toBeEnabled();
  await exportButton.click();

  // Dialog ist offen und beschreibt den Gesamt-Nachweis.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Stundennachweis exportieren")).toBeVisible();
  await expect(dialog.getByText("Gesamt-Nachweis aller Assistenten als PDF.")).toBeVisible();

  // Von-/Bis-Monat starten auf dem aktuellen Monat; für den Vormonat beide
  // Stepper einen Monat zurück navigieren.
  const fromLabel = dialog.getByTestId("export-from-label");
  const toLabel = dialog.getByTestId("export-to-label");
  const initialLabel = (await fromLabel.textContent())?.trim() ?? "";
  expect(initialLabel.length).toBeGreaterThan(0);

  // "Zurück"-Button = der erste Icon-Button in der jeweiligen Stepper-Zeile.
  const fromPrev = fromLabel.locator("xpath=..").locator("button").first();
  const toPrev = toLabel.locator("xpath=..").locator("button").first();
  await fromPrev.click();
  await toPrev.click();
  await expect(fromLabel).not.toHaveText(initialLabel);
  await expect(toLabel).not.toHaveText(initialLabel);

  // Genau ein Monat (der Vormonat) wird exportiert.
  await expect(dialog.getByText("1 Monat werden exportiert.")).toBeVisible();

  // Export starten und Download abfangen.
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Als PDF exportieren" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(expectedFilename);
});
