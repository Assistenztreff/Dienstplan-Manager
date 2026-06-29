import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test für das Anlegen und Bearbeiten einer Schicht über den ShiftDialog.
 *
 * Deckt den Kern-Schreibvorgang des Kalenders ab:
 * - Admin-Login über den echten Auth-Flow und Öffnen von /dienstplan
 * - Neue Schicht über das Tagesdetail-Panel anlegen (ShiftDialog ausfüllen + speichern)
 * - Prüfen, dass die neue Schicht im Kalender (Tagesdetail) erscheint
 * - Schicht bearbeiten (Startzeit ändern) und Aktualisierung prüfen
 *
 * Verwendet eindeutige Testdaten (Zeitstempel im Notizfeld + weit in der Zukunft
 * liegender Monat), um Kollisionen mit Bestandsdaten zu vermeiden.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

type ApiShift = {
  id: number;
  userId: number;
  startTime: string;
  endTime: string;
  type: string;
  notes?: string | null;
};

/** Parst das Label "MMMM yyyy" (z. B. "Juni 2026") in Jahr und 1-basierten Monat. */
function parseMonthLabel(text: string): { year: number; month: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]);
  const year = Number(parts[1]);
  expect(monthIndex, `Unbekannter Monatsname in "${text}"`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(year), `Ungültiges Jahr in "${text}"`).toBe(true);
  return { year, month: monthIndex + 1 };
}

/** data-testid einer Tageszelle für den n-ten Tag des angezeigten Monats. */
function dayCellId(year: number, month: number, dayOfMonth: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `day-cell-${year}-${mm}-${dd}`;
}

async function loginAsAdmin(page: Page): Promise<void> {
  // Delegiert an den gemeinsamen Helper, der den Vite-Dev-Auto-Login
  // toleriert (kein Login-Formular) und im Prod-Build das Formular ausfüllt.
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * Stellt sicher, dass mindestens ein Assistent existiert, und gibt dessen Namen
 * zurück (für die Auswahl im Dialog). Nutzt die authentifizierte Admin-Session.
 */
async function ensureAssistant(page: Page): Promise<{ id: number; name: string }> {
  const listRes = await page.request.get("/api/users?role=assistant");
  expect(listRes.ok(), "GET /api/users?role=assistant fehlgeschlagen").toBe(true);
  const assistants = (await listRes.json()) as { id: number; name: string }[];
  if (assistants.length > 0) return { id: assistants[0].id, name: assistants[0].name };

  const unique = Date.now();
  const createRes = await page.request.post("/api/users", {
    data: {
      name: `E2E Assistent ${unique}`,
      email: `e2e.assistant.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(createRes.ok(), "Anlegen des Test-Assistenten fehlgeschlagen").toBe(true);
  const created = (await createRes.json()) as { id: number; name: string };
  return { id: created.id, name: created.name };
}

/**
 * Stellt sicher, dass mindestens ein aktives Schichtmodell existiert, damit der
 * ShiftDialog im Anlegen-Modus eine reguläre (Zeit-)Schicht vorbelegt.
 */
async function ensureShiftModel(page: Page): Promise<void> {
  const listRes = await page.request.get("/api/shift-models?activeOnly=true");
  expect(listRes.ok(), "GET /api/shift-models fehlgeschlagen").toBe(true);
  const models = (await listRes.json()) as unknown[];
  if (models.length > 0) return;

  const createRes = await page.request.post("/api/shift-models", {
    data: { name: `E2E Modell ${Date.now()}`, color: "blue" },
  });
  expect(createRes.ok(), "Anlegen des Test-Schichtmodells fehlgeschlagen").toBe(true);
}

/** Findet eine Schicht des Monats anhand des eindeutigen Notiztexts. */
async function findShiftByNotes(
  page: Page,
  year: number,
  month: number,
  notes: string,
): Promise<ApiShift | undefined> {
  const res = await page.request.get(`/api/shifts?month=${month}&year=${year}`);
  expect(res.ok(), "GET /api/shifts fehlgeschlagen").toBe(true);
  const shifts = (await res.json()) as ApiShift[];
  return shifts.find((s) => s.notes === notes);
}

async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const mobile = page.getByTestId("dienstplan-mobile");
  await expect(mobile).toBeVisible();
  return mobile;
}

test.describe("ShiftDialog: Schicht anlegen und bearbeiten (Admin, mobile)", () => {
  test("legt eine Schicht an und bearbeitet sie anschließend", async ({ page }) => {
    await loginAsAdmin(page);
    const assistant = await ensureAssistant(page);
    await ensureShiftModel(page);

    const mobile = await openCalendar(page);

    // Auf einen weit in der Zukunft liegenden Monat navigieren, um Kollisionen
    // mit Bestandsschichten zu vermeiden.
    for (let i = 0; i < 15; i++) {
      await page.getByTestId("next-month").click();
    }
    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    // Einen festen Tag im Monat auswählen.
    const day = 16;
    const cell = mobile.getByTestId(dayCellId(year, month, day));
    await cell.click();
    await expect(cell).toHaveAttribute("data-selected", "true");

    // --- Neue Schicht anlegen ---------------------------------------------
    const uniqueNotes = `E2E Schicht ${Date.now()}`;
    const createStart = "09:17";
    const createEnd = "14:42";

    await mobile.getByTestId("add-shift").click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Neue Schicht anlegen")).toBeVisible();

    // Assistent auswählen.
    await dialog.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: assistant.name }).first().click();

    // Zeiten setzen (Typ ist durch das Schichtmodell bereits vorbelegt).
    await dialog.getByTestId("shift-dialog-start").fill(createStart);
    await dialog.getByTestId("shift-dialog-end").fill(createEnd);
    await dialog.getByTestId("shift-dialog-notes").fill(uniqueNotes);

    await dialog.getByTestId("shift-dialog-save").click();

    // Dialog schließt nach erfolgreichem Speichern.
    await expect(dialog).toHaveCount(0);

    // Die angelegte Schicht über die API auffinden (eindeutige Notiz).
    let created: ApiShift | undefined;
    await expect
      .poll(async () => {
        created = await findShiftByNotes(page, year, month, uniqueNotes);
        return created?.id ?? null;
      }, { message: "Angelegte Schicht wurde nicht gefunden" })
      .not.toBeNull();
    expect(created).toBeTruthy();
    const shiftId = created!.id;

    // Die Schicht erscheint im Tagesdetail des ausgewählten Tags.
    const badge = mobile.getByTestId(`shift-badge-${shiftId}`);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(`${createStart}–${createEnd}`);

    // --- Schicht bearbeiten -----------------------------------------------
    const editStart = "06:05";
    const editEnd = "11:30";

    await badge.click();
    const editDialog = page.getByTestId("shift-dialog");
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("Schicht bearbeiten")).toBeVisible();

    // Bestehende Zeit ist vorausgefüllt.
    await expect(editDialog.getByTestId("shift-dialog-start")).toHaveValue(createStart);

    await editDialog.getByTestId("shift-dialog-start").fill(editStart);
    await editDialog.getByTestId("shift-dialog-end").fill(editEnd);
    await editDialog.getByTestId("shift-dialog-save").click();

    await expect(editDialog).toHaveCount(0);

    // Die aktualisierte Zeit erscheint im Kalender.
    const updatedBadge = mobile.getByTestId(`shift-badge-${shiftId}`);
    await expect(updatedBadge).toBeVisible();
    await expect(updatedBadge).toContainText(`${editStart}–${editEnd}`);

    // --- Aufräumen: Testschicht entfernen ---------------------------------
    const del = await page.request.delete(`/api/shifts/${shiftId}`);
    expect(del.ok(), "Aufräumen der Testschicht fehlgeschlagen").toBe(true);
  });
});
