import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  setAccountPlan,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E-Test (#370, frühere Idee #300): Der Wochentags-/Vorlagen-Hinweis des
 * Schichtmodells erscheint auch im MEHRFACH-Anlegemodus korrekt.
 *
 * Beweist zwei zusammengehörige Verhalten des ShiftDialog im Bulk-Modus:
 *  - Werden mehrere Tage inkl. „unpassender" Wochentage ausgewählt, zeigt der
 *    Dialog den Wochentags-Hinweis (`shift-dialog-weekday-mismatch`) mit den
 *    Standard-Wochentagen des Modells und der Anzahl nicht passender Tage.
 *  - Die Auswahl eines Schichtmodells belegt Start-/Endzeit mit dessen
 *    Standardzeiten vor (auch im Mehrfach-Modus).
 *
 * Setup: Ein frisch registrierter Arbeitgeber wird auf Premium gehoben
 * (Massenbearbeitung ist ein Premium-Feature), ein Assistent und ein
 * Schichtmodell mit definierten Standard-Wochentagen/-zeiten werden per API
 * angelegt. Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der
 * `_test`-DB).
 */

const MODEL_NAME = `E2E Wochentagsdienst ${Date.now()}`;
const MODEL_START = "07:30";
const MODEL_END = "15:45";
// Standard-Wochentage Mo–Fr (ISO 1..5); Wochenendtage passen also NICHT.
const MODEL_WEEKDAYS = [1, 2, 3, 4, 5];

/** Session-Cookies des per API angelegten Kontos in den Browser übernehmen. */
async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

/** ISO-Wochentag (1=Mo .. 7=So) eines lokalen Datums (yyyy-MM-dd). */
function isoWeekday(dateStr: string): number {
  return ((new Date(`${dateStr}T00:00:00`).getDay() + 6) % 7) + 1;
}

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Parst das Label "MMMM yyyy" (z. B. "Juni 2026") in Jahr und 1-basierten Monat. */
function parseMonthLabel(text: string): { year: number; month: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]);
  const year = Number(parts[1]);
  expect(monthIndex, `Unbekannter Monatsname in "${text}"`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(year), `Ungültiges Jahr in "${text}"`).toBe(true);
  return { year, month: monthIndex + 1 };
}

/** data-testid einer Tageszelle des Monatsgitters. */
function dayCellId(year: number, month: number, dayOfMonth: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `day-cell-${year}-${mm}-${dd}`;
}

/** Findet den ersten Tag des Monats mit gegebenem ISO-Wochentag. */
function firstDayWithWeekday(year: number, month: number, weekday: number): number {
  for (let d = 1; d <= 28; d++) {
    const mm = String(month).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    if (isoWeekday(`${year}-${mm}-${dd}`) === weekday) return d;
  }
  throw new Error(`Kein Tag mit Wochentag ${weekday} im Monat ${month}/${year} gefunden`);
}

async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const mobile = page.getByTestId("dienstplan-mobile");
  await expect(mobile).toBeVisible();
  return mobile;
}

test.describe("ShiftDialog: Wochentags-/Vorlagen-Hinweis im Mehrfach-Modus", () => {
  let employer: FreeAccount;

  test.beforeAll(async () => {
    // Arbeitgeber registrieren und auf Premium heben (Massenbearbeitung =
    // Premium-Feature). Erst NACH dem Premium-Flip das Schichtmodell anlegen
    // (Registrierung seedet bereits 5 Modelle = Free-Limit).
    employer = await registerFreeAccount("privat", "mehrfach.hinweis");
    setAccountPlan(employer.email, "premium");

    // Assistent, damit der Dialog einen wählbaren Nutzer hat.
    const userRes = await employer.ctx.post("/api/users", {
      data: {
        name: "Mehrfach Assistentin",
        email: `e2e.mehrfach.assistentin.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(userRes.status(), "Assistent anlegen sollte 201 liefern").toBe(201);

    // Schichtmodell mit definierten Standard-Wochentagen und -zeiten.
    const modelRes = await employer.ctx.post("/api/shift-models", {
      data: {
        name: MODEL_NAME,
        valuationPercent: 100,
        defaultStartTime: MODEL_START,
        defaultEndTime: MODEL_END,
        defaultWeekdays: MODEL_WEEKDAYS,
      },
    });
    expect(modelRes.status(), "Schichtmodell anlegen sollte 201 liefern").toBe(201);
  });

  test.afterAll(async () => {
    await deleteFreeAccount(employer);
  });

  test("zeigt den Wochentags-Hinweis und belegt die Modell-Standardzeiten vor", async ({
    page,
  }) => {
    test.setTimeout(60000);
    await adoptSession(page, employer);

    const mobile = await openCalendar(page);

    // In einen zukünftigen Monat navigieren (deterministische Wochentags-Berechnung).
    for (let i = 0; i < 2; i++) {
      await page.getByTestId("next-month").click();
    }
    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    // Zwei „unpassende" Tage (Sa=6, So=7) und ein passender Tag (Mo=1).
    const saturday = firstDayWithWeekday(year, month, 6);
    const sunday = firstDayWithWeekday(year, month, 7);
    const monday = firstDayWithWeekday(year, month, 1);
    const selectedDays = [monday, saturday, sunday];
    const expectedMismatch = 2; // Sa + So passen nicht zu Mo–Fr

    // --- Mehrfach-Modus aktivieren und Tage auswählen ---------------------
    await page.getByTestId("toggle-selection-mode").click();
    for (const day of selectedDays) {
      const cell = mobile.getByTestId(dayCellId(year, month, day));
      await cell.click();
      await expect(cell).toHaveAttribute("data-selected", "true");
    }

    // Aktionsleiste zeigt die Anzahl ausgewählter Tage.
    await expect(page.getByTestId("bulk-selected-count")).toHaveText(
      `${selectedDays.length} Tage ausgewählt`,
    );

    // --- Mehrfach-Anlege-Dialog öffnen ------------------------------------
    await page.getByTestId("bulk-create-open").click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Schichten eintragen")).toBeVisible();

    // Der Dialog fasst die ausgewählten Tage zusammen.
    await expect(dialog.getByTestId("shift-dialog-bulk-summary")).toContainText(
      `${selectedDays.length} Tage ausgewählt`,
    );

    // Das definierte Schichtmodell auswählen -> Standardzeiten werden vorbelegt.
    await dialog.getByTestId("shift-dialog-type").click();
    await page.getByRole("option", { name: MODEL_NAME }).first().click();

    // Vorbelegte Modell-Standardzeiten auch im Mehrfach-Modus.
    await expect(dialog.getByTestId("shift-dialog-start")).toHaveValue(MODEL_START);
    await expect(dialog.getByTestId("shift-dialog-end")).toHaveValue(MODEL_END);

    // Wochentags-Hinweis: Modellname, Standard-Wochentage und Anzahl nicht
    // passender Tage werden angezeigt.
    const mismatch = dialog.getByTestId("shift-dialog-weekday-mismatch");
    await expect(mismatch).toBeVisible();
    await expect(mismatch).toContainText(MODEL_NAME);
    await expect(mismatch).toContainText("Mo, Di, Mi, Do, Fr");
    await expect(mismatch).toContainText(`${expectedMismatch} der ausgewählten Tage passen nicht`);
  });
});
