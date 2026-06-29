import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test: Beim Öffnen einer Nachtschicht ÜBER MITTERNACHT (z. B. 22:00–06:00)
 * im Bearbeiten-Modus werden Datum (Starttag), Start- und Endzeit korrekt aus
 * der Schicht vorbelegt — und ein Speichern ohne Änderung verschiebt die Zeiten
 * NICHT (keine Drift durch ISO-/Zeitzonen-Umrechnung über den Tagesübergang).
 *
 * Regressionsschutz für Task #118: Task #99 sichert nur den Prefill einer
 * regulären Schicht (gleicher Tag) ab. Der heikelste Fall ist eine Schicht über
 * Mitternacht: Die Endzeit wird per `nextDayString` auf den Folgetag gelegt
 * (`endsNextDay = form.endTime <= form.startTime`) und beim Bearbeiten liest der
 * Prefill (`toDateString`/`toTimeString`) beide ISO-Zeitstempel zurück. Ein
 * Zeitzonen-/Tagesübergang-Fehler würde nur hier auffallen.
 *
 * Dieser Test prüft zusätzlich zum bestehenden (gleicher Tag) Prefill-Test:
 * - das Datum-Feld (`shift-dialog-date`) zeigt den STARTTAG der Nachtschicht,
 * - Start-/Endzeit (`shift-dialog-start` / `shift-dialog-end`) sind korrekt
 *   vorbelegt (22:00 / 06:00),
 * - nach unverändertem Speichern bleiben startTime/endTime per API exakt
 *   identisch UND endTime liegt weiterhin am Folgetag und ist > startTime.
 *
 * Ablauf:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent + Schichtmodell sicherstellen, Nachtschicht über den Dialog anlegen
 * - Schicht im Kalender öffnen (Bearbeiten-Modus), Prefill prüfen
 * - Ohne Änderung speichern und per API verifizieren (keine Drift, Folgetag-Ende)
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

test.describe("ShiftDialog: Bearbeiten belegt Nachtschicht über Mitternacht korrekt vor (Admin, mobile)", () => {
  test("Datum/Start/Ende sind vorbelegt, Ende bleibt am Folgetag und driftet nach unverändertem Speichern nicht", async ({ page }) => {
    await loginAsAdmin(page);
    const assistant = await ensureAssistant(page);
    await ensureShiftModel(page);

    const mobile = await openCalendar(page);

    // In einen weit in der Zukunft liegenden Monat navigieren (Kollisionsschutz).
    for (let i = 0; i < 22; i++) {
      await page.getByTestId("next-month").click();
    }
    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    // Bewusst ein Tag früh genug im Monat, damit der Folgetag (Ende) sicher
    // existiert; Tag 16 ist ungefährlich für jeden Monat.
    const day = 16;
    const expectedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = mobile.getByTestId(dayCellId(year, month, day));
    await cell.click();
    await expect(cell).toHaveAttribute("data-selected", "true");

    // --- Nachtschicht über Mitternacht anlegen (Ende < Start → Folgetag) ----
    const uniqueNotes = `E2E Prefill Nacht ${Date.now()}`;
    const createStart = "22:00";
    const createEnd = "06:00";

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
      }, { message: "Angelegte Nachtschicht wurde nicht gefunden" })
      .not.toBeNull();
    expect(created).toBeTruthy();
    const shiftId = created!.id;
    const originalStart = created!.startTime;
    const originalEnd = created!.endTime;

    // Vorbedingung: Das Ende der angelegten Nachtschicht liegt am Folgetag und
    // ist > Start (sonst testet der Prefill nicht den Tagesübergang).
    expect(
      new Date(originalEnd).getTime(),
      "endTime der angelegten Nachtschicht muss > startTime sein",
    ).toBeGreaterThan(new Date(originalStart).getTime());
    expect(
      new Date(originalEnd).getTime() - new Date(originalStart).getTime(),
      "Nachtschicht 22:00–06:00 muss 8 Stunden umfassen (Ende am Folgetag)",
    ).toBe(8 * 60 * 60 * 1000);

    // --- Schicht im Bearbeiten-Modus öffnen --------------------------------
    const badge = mobile.getByTestId(`shift-badge-${shiftId}`);
    await expect(badge).toBeVisible();
    await badge.click();

    const editDialog = page.getByTestId("shift-dialog");
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("Schicht bearbeiten")).toBeVisible();

    // --- Prefill prüfen: Datum = STARTTAG, Zeiten = 22:00 / 06:00 ----------
    await expect(
      editDialog.getByTestId("shift-dialog-date"),
      "Datum muss der Starttag der Nachtschicht sein (nicht der Folgetag des Endes)",
    ).toHaveValue(expectedDate);
    await expect(
      editDialog.getByTestId("shift-dialog-start"),
      "Startzeit muss aus der Schicht vorbelegt sein",
    ).toHaveValue(createStart);
    await expect(
      editDialog.getByTestId("shift-dialog-end"),
      "Endzeit (Folgetag) muss als reine Uhrzeit vorbelegt sein",
    ).toHaveValue(createEnd);

    // --- Ohne Änderung speichern -------------------------------------------
    await editDialog.getByTestId("shift-dialog-save").click();
    await expect(editDialog).toHaveCount(0);

    // --- Verifikation: keine Zeit-Drift, Ende weiterhin am Folgetag --------
    let afterSave: ApiShift | undefined;
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/shifts/${shiftId}`);
        if (!res.ok()) return null;
        afterSave = (await res.json()) as ApiShift;
        return afterSave.id;
      }, { message: "Nachtschicht nach dem Speichern nicht gefunden" })
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
    // Tagesübergang muss erhalten bleiben: Ende weiterhin > Start.
    expect(
      new Date(afterSave!.endTime).getTime(),
      "endTime muss nach dem Speichern weiterhin am Folgetag (> startTime) liegen",
    ).toBeGreaterThan(new Date(afterSave!.startTime).getTime());

    // --- Aufräumen ---------------------------------------------------------
    const del = await page.request.delete(`/api/shifts/${shiftId}`);
    expect(del.ok(), "Aufräumen der Test-Nachtschicht fehlgeschlagen").toBe(true);
  });
});
