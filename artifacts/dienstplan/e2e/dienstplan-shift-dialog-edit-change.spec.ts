import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { clearUserShiftsAroundDay, pickShiftDialogDate, selectDayCell } from "./helpers/shifts";

/**
 * E2E-Test: Beim Bearbeiten einer bestehenden Schicht werden geänderte Werte
 * für Datum und Start-/Endzeit korrekt als neuer ISO-Zeitstempel gespeichert —
 * ohne Off-by-one beim Datum oder Stunden-Verschiebung durch die
 * ISO-/Zeitzonen-Umrechnung.
 *
 * Komplement zu Task #99 (dienstplan-shift-dialog-edit-prefill.spec.ts): Jener
 * Test sichert nur den Prefill und das unveränderte Speichern (keine Drift) ab.
 * Hier wird der Gegenfall geprüft:
 * - eine bestehende Schicht wird im Bearbeiten-Modus geöffnet,
 * - Datum UND Start-/Endzeit werden geändert und gespeichert,
 * - per API wird verifiziert, dass startTime/endTime exakt den neuen Werten
 *   entsprechen (Round-Trip buildIso identisch zur Dialog-Logik).
 *
 * Ablauf:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent + Schichtmodell sicherstellen, Schicht über den Dialog anlegen
 * - Schicht im Kalender öffnen (Bearbeiten-Modus)
 * - Datum auf einen anderen Tag und Start-/Endzeit auf neue Werte setzen
 * - Speichern und per API verifizieren, dass startTime/endTime exakt passen
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

// Spiegelt die buildIso-Logik aus shift-dialog.tsx, um den erwarteten
// Zeitstempel deterministisch (lokale Zeitzone) zu berechnen.
function buildIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
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

test.describe("ShiftDialog: Bearbeiten speichert geändertes Datum/Zeit korrekt (Admin, mobile)", () => {
  test("Geändertes Datum und Start-/Endzeit landen exakt als neuer ISO-Zeitstempel", async ({ page }) => {
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const assistant = await ensureAssistant(page);
    await ensureShiftModel(page);

    const mobile = await openCalendar(page);

    // In einen weit in der Zukunft liegenden Monat navigieren (Kollisionsschutz).
    for (let i = 0; i < 5; i++) {
      await page.getByTestId("next-month").click();
    }
    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );
    await clearUserShiftsAroundDay(page, year, month, 10, assistant.id);

    const createDay = 10;
    const cell = mobile.getByTestId(dayCellId(year, month, createDay));
    await selectDayCell(page, cell);
    await expect(cell).toHaveAttribute("data-selected", "true");

    // --- Schicht mit bekanntem Datum/Zeit anlegen --------------------------
    const uniqueNotes = `E2E Change ${Date.now()}`;
    const createStart = "09:30";
    const createEnd = "14:45";

    await page.getByTestId("add-shift").click();
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

    // --- Schicht im Bearbeiten-Modus öffnen --------------------------------
    const badge = page.getByTestId("schedule-list").getByTestId(`shift-badge-${shiftId}`);
    await expect(badge).toBeVisible();
    await badge.click();

    const editDialog = page.getByTestId("shift-dialog");
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("Schicht bearbeiten")).toBeVisible();

    // --- Datum und Zeiten ändern -------------------------------------------
    const newDay = 21;
    const newDate = `${year}-${String(month).padStart(2, "0")}-${String(newDay).padStart(2, "0")}`;
    const newStart = "11:15";
    const newEnd = "17:20";

    await pickShiftDialogDate(page, editDialog, newDate);
    await editDialog.getByTestId("shift-dialog-start").fill(newStart);
    await editDialog.getByTestId("shift-dialog-end").fill(newEnd);

    // Zur Sicherheit: die geänderten Werte sind im Formular gesetzt.
    await expect(editDialog.getByTestId("shift-dialog-date")).toHaveAttribute("data-value", newDate);
    await expect(editDialog.getByTestId("shift-dialog-start")).toHaveValue(newStart);
    await expect(editDialog.getByTestId("shift-dialog-end")).toHaveValue(newEnd);

    await editDialog.getByTestId("shift-dialog-save").click();
    await expect(editDialog).toHaveCount(0);

    // --- Verifikation: neue Werte exakt gespeichert ------------------------
    const expectedStartIso = buildIso(newDate, newStart);
    const expectedEndIso = buildIso(newDate, newEnd);

    let afterSave: ApiShift | undefined;
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/shifts/${shiftId}`);
        if (!res.ok()) return null;
        afterSave = (await res.json()) as ApiShift;
        return new Date(afterSave.startTime).getTime();
      }, { message: "Geänderte Schicht-Startzeit wurde nicht übernommen" })
      .toBe(new Date(expectedStartIso).getTime());

    expect(afterSave).toBeTruthy();
    expect(
      new Date(afterSave!.startTime).getTime(),
      "startTime muss exakt dem geänderten Datum + Startzeit entsprechen (kein Off-by-one/Drift)",
    ).toBe(new Date(expectedStartIso).getTime());
    expect(
      new Date(afterSave!.endTime).getTime(),
      "endTime muss exakt dem geänderten Datum + Endzeit entsprechen (kein Off-by-one/Drift)",
    ).toBe(new Date(expectedEndIso).getTime());

    // --- Aufräumen ---------------------------------------------------------
    const del = await page.request.delete(`/api/shifts/${shiftId}`);
    expect(del.ok(), "Aufräumen der Testschicht fehlgeschlagen").toBe(true);
  });
});
