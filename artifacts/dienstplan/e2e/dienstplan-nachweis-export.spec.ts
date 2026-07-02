import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test für den Einzel-Nachweis-Export auf der Assistenten-Detailseite.
 *
 * Der "Nachweis"-Button auf jeder Assistenten-Karte öffnet einen Dialog mit
 * Monatsauswahl und erzeugt ein PDF nur für diesen einen Assistenten.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent + Vertrag anlegen, eine Schicht im Zielmonat buchen
 * - Öffnen des "Nachweis"-Dialogs auf der Assistenten-Karte
 * - Monatsnavigation (einen Monat zurück) verändert die Monatsanzeige
 * - Der PDF-Export löst einen Download mit dem erwarteten Dateinamen aus:
 *   Stundennachweis_<Name>_<Jahr>_<Monat>.pdf
 * - Die heruntergeladene PDF enthält genau EINE Seite und den erwarteten
 *   Monatsnamen ("Monat: <MMMM yyyy>") — schützt vor stillen Regressen
 *   (leere/zusätzliche Seite, falscher Monat).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:80";

// Desktop-Viewport: die Assistenten-Karten und der Dialog sind in beiden
// Viewports nutzbar; Desktop hält das Karten-Layout stabil.
test.use({ viewport: { width: 1280, height: 800 } });

// Zielmonat = der Vormonat (relativ zum Dialog-Start, der mit `new Date()`
// initialisiert wird). Ein Klick auf "zurück" navigiert genau dorthin.
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
let expectedFilename: string;

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
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
      name: `E2E Nachweis ${unique}`,
      email: `e2e.nachweis.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(userRes.ok(), `Anlegen des Assistenten fehlgeschlagen (${userRes.status()})`).toBe(true);
  assistant = (await userRes.json()) as CreatedUser;
  expectedFilename = `Stundennachweis_${safeName(assistant.name)}_${TARGET_YEAR}_${TARGET_MM}.pdf`;

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

  // Eine Schicht im Zielmonat, damit der Nachweis nicht leer ist.
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

test("Nachweis-Dialog navigiert den Monat und löst PDF-Download mit erwartetem Dateinamen aus", async ({
  page,
}) => {
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/assistenten");
  await expect(page.getByRole("heading", { name: "Assistenten", exact: true })).toBeVisible();

  // Karte des angelegten Assistenten finden und "Nachweis" öffnen.
  const card = page.getByTestId(`assistant-card-${assistant.id}`);
  await expect(card).toBeVisible();
  await card.getByTitle("Stundennachweis als PDF exportieren").click();

  // Dialog ist offen.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Stundennachweis exportieren")).toBeVisible();
  await expect(dialog.getByText(assistant.name)).toBeVisible();

  // Von-/Bis-Monat starten auf dem aktuellen Monat; für den Einzel-Nachweis des
  // Vormonats beide Stepper einen Monat zurück navigieren.
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

  // Heruntergeladenes PDF speichern und inhaltlich prüfen: Der Einzel-Export
  // darf genau EINE Seite erzeugen und muss den Zielmonat benennen.
  const pdfPath = await download.path();
  expect(pdfPath, "Download-Pfad des PDFs fehlt").toBeTruthy();
  const pdfBytes = await readFile(pdfPath as string);
  // jsPDF erzeugt unkomprimierte PDFs: Seitenobjekte tragen `/Type /Page`
  // (der Seitenbaum-Knoten dagegen `/Type /Pages`, hier ausgeschlossen).
  const pdfText = pdfBytes.toString("latin1");
  const pageCount = (pdfText.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
  expect(pageCount, "Einzel-Monats-Nachweis muss genau eine PDF-Seite enthalten").toBe(1);

  // Die Seite trägt den Monatsnamen des exportierten Vormonats.
  const monthLabel = format(TARGET, "MMMM yyyy", { locale: de });
  expect(
    pdfText.includes(`Monat: ${monthLabel}`),
    `PDF muss den Monat "${monthLabel}" ausweisen`
  ).toBe(true);
});
