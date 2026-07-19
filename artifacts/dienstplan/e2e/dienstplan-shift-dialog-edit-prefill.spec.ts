import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { clearUserShiftsAroundDay, selectDayCell } from "./helpers/shifts";

/**
 * E2E-Test: Beim Öffnen einer bestehenden Schicht im Bearbeiten-Modus werden
 * Datum, Start- und Endzeit korrekt aus der Schicht vorbelegt — und ein
 * Speichern ohne Änderung verschiebt die Zeiten NICHT (keine Drift durch
 * ISO-/Zeitzonen-Umrechnung).
 *
 * Regressionsschutz für Task #99: Die bestehenden Dialog-Tests sichern nur den
 * Assistenten-Namen (#57) und die Assistenten-Sperre (#79) ab. Dieser Test
 * prüft zusätzlich:
 * - das Datum-Feld (`shift-dialog-date`) zeigt das korrekte Schicht-Datum,
 * - Start-/Endzeit (`shift-dialog-start` / `shift-dialog-end`) sind korrekt
 *   vorbelegt,
 * - nach unverändertem Speichern bleiben startTime/endTime der Schicht per API
 *   exakt identisch (Round-Trip toTimeString/toDateString → buildIso).
 *
 * Ablauf:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent + Schichtmodell sicherstellen, Schicht über den Dialog anlegen
 * - Schicht im Kalender öffnen (Bearbeiten-Modus), Prefill von Datum/Zeiten prüfen
 * - Ohne Änderung speichern und per API verifizieren, dass startTime/endTime
 *   unverändert sind
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

function parseMonthLabel(text: string): { year: number; month: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]);
  const year = Number(parts[1]);
  expect(monthIndex, `Unbekannter Monatsname in "${text}"`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(year), `Ungültiges Jahr in "${text}"`).toBe(true);
  return { year, month: monthIndex + 1 };
}

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

test.describe("ShiftDialog: Bearbeiten belegt Datum/Zeit korrekt vor (Admin, mobile)", () => {
  test("Datum und Zeiten sind vorbelegt und driften nach unverändertem Speichern nicht", async ({ page }) => {
    await loginAsAdmin(page);
    const assistant = await ensureAssistant(page);
    await ensureShiftModel(page);

    const mobile = await openCalendar(page);

    // In einen weit in der Zukunft liegenden Monat navigieren (Kollisionsschutz).
    for (let i = 0; i < 4; i++) {
      await page.getByTestId("next-month").click();
    }
    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );
    await clearUserShiftsAroundDay(page, year, month, 16, assistant.id);

    const day = 16;
    const expectedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = mobile.getByTestId(dayCellId(year, month, day));
    await selectDayCell(page, cell);
    await expect(cell).toHaveAttribute("data-selected", "true");

    // --- Schicht mit bekanntem Datum/Zeit anlegen --------------------------
    const uniqueNotes = `E2E Prefill ${Date.now()}`;
    const createStart = "09:30";
    const createEnd = "14:45";

    await mobile.getByTestId("add-shift").click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Neue Schicht anlegen")).toBeVisible();

    await dialog.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: assistant.name }).first().click();

    await dialog.getByTestId("shift-dialog-start").fill(createStart);
    await dialog.getByTestId("shift-dialog-end").fill(createEnd);
    await dialog.getByTestId("shift-dialog-notes").fill(uniqueNotes);

    await dialog.getByTestId("shift-dialog-save").click();
    await expect(dialog).toHaveCount(0);

    let created: ApiShift | undefined;
    await expect
      .poll(async () => {
        created = await findShiftByNotes(page, year, month, uniqueNotes);
        return created?.id ?? null;
      }, { message: "Angelegte Schicht wurde nicht gefunden" })
      .not.toBeNull();
    expect(created).toBeTruthy();
    const shiftId = created!.id;
    const originalStart = created!.startTime;
    const originalEnd = created!.endTime;

    // --- Schicht im Bearbeiten-Modus öffnen --------------------------------
    const badge = mobile.getByTestId(`shift-badge-${shiftId}`);
    await expect(badge).toBeVisible();
    await badge.click();

    const editDialog = page.getByTestId("shift-dialog");
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("Schicht bearbeiten")).toBeVisible();

    // --- Prefill von Datum, Start- und Endzeit prüfen ----------------------
    await expect(
      editDialog.getByTestId("shift-dialog-date"),
      "Datum muss aus der Schicht vorbelegt sein",
    ).toHaveAttribute("data-value", expectedDate);
    await expect(
      editDialog.getByTestId("shift-dialog-start"),
      "Startzeit muss aus der Schicht vorbelegt sein",
    ).toHaveValue(createStart);
    await expect(
      editDialog.getByTestId("shift-dialog-end"),
      "Endzeit muss aus der Schicht vorbelegt sein",
    ).toHaveValue(createEnd);

    // --- Ohne Änderung speichern -------------------------------------------
    await editDialog.getByTestId("shift-dialog-save").click();
    await expect(editDialog).toHaveCount(0);

    // --- Verifikation: keine Zeit-Drift ------------------------------------
    let afterSave: ApiShift | undefined;
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/shifts/${shiftId}`);
        if (!res.ok()) return null;
        afterSave = (await res.json()) as ApiShift;
        return afterSave.id;
      }, { message: "Schicht nach dem Speichern nicht gefunden" })
      .toBe(shiftId);
    expect(afterSave).toBeTruthy();
    expect(
      new Date(afterSave!.startTime).getTime(),
      "startTime darf sich beim unveränderten Speichern nicht verschieben",
    ).toBe(new Date(originalStart).getTime());
    expect(
      new Date(afterSave!.endTime).getTime(),
      "endTime darf sich beim unveränderten Speichern nicht verschieben",
    ).toBe(new Date(originalEnd).getTime());

    // --- Aufräumen ---------------------------------------------------------
    const del = await page.request.delete(`/api/shifts/${shiftId}`);
    expect(del.ok(), "Aufräumen der Testschicht fehlgeschlagen").toBe(true);
  });
});
