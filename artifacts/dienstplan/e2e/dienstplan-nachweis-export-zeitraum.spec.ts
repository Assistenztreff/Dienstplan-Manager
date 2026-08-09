import {
  test,
  expect,
  request as playwrightRequest,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { format } from "date-fns";
import { de } from "date-fns/locale";

/**
 * E2E-Test für den Zeitraum-Nachweis-Export (Von-/Bis-Monat) auf der
 * Assistenten-Detailseite.
 *
 * Der "Nachweis"-Button öffnet einen Dialog mit getrennter Von-/Bis-Monat-
 * Auswahl. Pro Monat im Zeitraum entsteht eine PDF-Seite; der Dateiname trägt
 * bei mehreren Monaten den Spannen-Suffix
 * Stundennachweis_<Name>_<VonJahr>_<VonMonat>-<BisJahr>_<BisMonat>.pdf.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent + Vertrag + Schichten in mehreren Monaten anlegen
 * - Öffnen des "Nachweis"-Dialogs auf der Assistenten-Karte
 * - Mehrmonats-Auswahl über den Bis-Stepper (testids export-from-label /
 *   export-to-label) verändert die Bis-Anzeige
 * - Die Monatsanzahl-Anzeige zeigt die korrekte Zahl ("3 Monate")
 * - Ein ungültiger Zeitraum (Bis vor Von) zeigt die Fehlermeldung und
 *   deaktiviert den Export-Button
 * - Der PDF-Export löst einen Download mit dem erwarteten Mehrmonats-Dateinamen
 *   aus
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: hält das Assistenten-Karten-Layout stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Dialog initialisiert Von- und Bis-Monat mit `new Date()` (aktueller Monat).
// Zeitraum = aktueller Monat bis aktueller Monat + 2 → 3 Monate.
const NOW = new Date();
const FROM = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
const TO = new Date(NOW.getFullYear(), NOW.getMonth() + 2, 1);
const MONTH_COUNT = 3;

function mm(d: Date): string {
  return String(d.getMonth() + 1).padStart(2, "0");
}
function dayInMonth(d: Date): string {
  return `${d.getFullYear()}-${mm(d)}-15`;
}

type CreatedUser = { id: number; name: string; email: string };
type Contract = { id: number };

let adminCtx: APIRequestContext;
let assistant: CreatedUser;
let contractId: number;
const shiftIds: number[] = [];
let expectedFilename: string;

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
}

async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
  // der Vite-Dev-Auto-Login (der sonst als Seed-Admin anmeldet) greift nie —
  // der Test agiert garantiert als der gewünschte Nutzer (dev- UND prod-tauglich).
  const res = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(res.ok(), `Login als ${email} fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
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
      name: `E2E Zeitraum ${unique}`,
      email: `e2e.zeitraum.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen des Assistenten fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistant = (await userRes.json()) as CreatedUser;
  expectedFilename = `Stundennachweis_${safeName(assistant.name)}_${FROM.getFullYear()}_${mm(
    FROM
  )}-${TO.getFullYear()}_${mm(TO)}.pdf`;

  const contractRes = await adminCtx.post("/api/contracts", {
    data: {
      userId: assistant.id,
      startDate: `${FROM.getFullYear()}-01-01`,
      weeklyHours: 40,
      vacationDays: 30,
    },
  });
  expect(contractRes.ok(), `Anlegen des Vertrags fehlgeschlagen (${contractRes.status()})`).toBe(
    true
  );
  contractId = ((await contractRes.json()) as Contract).id;

  // Je eine Schicht im ersten und letzten Monat des Zeitraums, damit der
  // Nachweis über mehrere Monate echte Daten enthält.
  for (const monthDate of [FROM, TO]) {
    const day = dayInMonth(monthDate);
    const shiftRes = await adminCtx.post("/api/shifts", {
      data: {
        userId: assistant.id,
        startTime: `${day}T08:00:00.000Z`,
        endTime: `${day}T16:00:00.000Z`,
        type: "active",
      },
    });
    expect(shiftRes.ok(), `Anlegen der Schicht fehlgeschlagen (${shiftRes.status()})`).toBe(true);
    shiftIds.push(((await shiftRes.json()) as { id: number }).id);
  }
});

test.afterAll(async () => {
  for (const id of shiftIds) await adminCtx.delete(`/api/shifts/${id}`);
  if (contractId) await adminCtx.delete(`/api/contracts/${contractId}`);
  if (assistant?.id) await adminCtx.delete(`/api/users/${assistant.id}`);
  await adminCtx.dispose();
});

test("Zeitraum-Nachweis: Mehrmonats-Auswahl, Validierung und PDF-Download", async ({ page }) => {
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/team-verwaltung");
  await expect(page.getByRole("heading", { name: "Team-Verwaltung", exact: true })).toBeVisible();

  const card = page.getByTestId(`assistant-card-${assistant.id}`);
  await expect(card).toBeVisible();
  await card.getByTitle("Stundennachweis als PDF exportieren").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Stundennachweis exportieren")).toBeVisible();
  await expect(dialog.getByText(assistant.name)).toBeVisible();

  const fromLabel = dialog.getByTestId("export-from-label");
  const toLabel = dialog.getByTestId("export-to-label");

  // Beide Stepper starten auf dem aktuellen Monat → 1 Monat.
  const initialFrom = (await fromLabel.textContent())?.trim() ?? "";
  const initialTo = (await toLabel.textContent())?.trim() ?? "";
  expect(initialFrom.length).toBeGreaterThan(0);
  expect(initialFrom).toBe(initialTo);
  await expect(dialog.getByText("1 Monat werden exportiert.")).toBeVisible();

  // Stepper-Buttons: innerhalb der Von-/Bis-Zeile ist der erste Button "zurück"
  // (-1) und der letzte "vor" (+1).
  const fromRow = fromLabel.locator("xpath=..");
  const toRow = toLabel.locator("xpath=..");
  const fromNext = fromRow.locator("button").last();
  const fromPrev = fromRow.locator("button").first();
  const toNext = toRow.locator("button").last();

  // Bis-Monat zweimal vorwärts → Zeitraum über 3 Monate.
  await toNext.click();
  await toNext.click();
  await expect(toLabel).not.toHaveText(initialTo);
  await expect(dialog.getByText(`${MONTH_COUNT} Monate werden exportiert.`)).toBeVisible();

  const exportButton = dialog.getByRole("button", { name: "Als PDF exportieren" });
  await expect(exportButton).toBeEnabled();

  // Ungültiger Zeitraum: Von hinter Bis schieben (4 Schritte vor → Von liegt
  // einen Monat hinter dem Bis-Monat).
  for (let i = 0; i < MONTH_COUNT + 1; i++) {
    await fromNext.click();
  }
  await expect(
    dialog.getByText("Der Bis-Monat darf nicht vor dem Von-Monat liegen.")
  ).toBeVisible();
  await expect(exportButton).toBeDisabled();

  // Von zurück auf den Ausgangsmonat → wieder gültiger 3-Monats-Zeitraum.
  for (let i = 0; i < MONTH_COUNT + 1; i++) {
    await fromPrev.click();
  }
  await expect(fromLabel).toHaveText(initialFrom);
  await expect(dialog.getByText(`${MONTH_COUNT} Monate werden exportiert.`)).toBeVisible();
  await expect(exportButton).toBeEnabled();

  // Export starten und Mehrmonats-Download abfangen.
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(expectedFilename);

  // Heruntergeladenes PDF speichern und seinen Inhalt prüfen, damit der Test
  // nicht nur am Dateinamen hängt, sondern beweist, dass tatsächlich pro Monat
  // eine Seite erzeugt wird.
  const pdfPath = await download.path();
  expect(pdfPath, "Download-Pfad des PDFs fehlt").toBeTruthy();
  const pdfBytes = await readFile(pdfPath as string);
  // jsPDF erzeugt unkomprimierte PDFs: Seitenobjekte tragen `/Type /Page`
  // (der Seitenbaum-Knoten dagegen `/Type /Pages`, hier ausgeschlossen).
  const pdfText = pdfBytes.toString("latin1");
  const pageCount = (pdfText.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
  expect(pageCount, "PDF muss genau eine Seite pro Monat enthalten").toBe(MONTH_COUNT);

  // Jede Seite trägt ihren Monatsnamen ("Monat: <MMMM yyyy>"). Für den
  // 3-Monats-Zeitraum müssen alle drei Monatsbezeichnungen im PDF vorkommen.
  for (let i = 0; i < MONTH_COUNT; i++) {
    const monthDate = new Date(FROM.getFullYear(), FROM.getMonth() + i, 1);
    const monthLabel = format(monthDate, "MMMM yyyy", { locale: de });
    expect(
      pdfText.includes(`Monat: ${monthLabel}`),
      `PDF muss den Monat "${monthLabel}" als eigene Seite enthalten`
    ).toBe(true);
  }
});
