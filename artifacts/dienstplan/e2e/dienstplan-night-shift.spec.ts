import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { clearUserShiftsAroundDay, selectDayCell } from "./helpers/shifts";

/**
 * E2E-Test für Nachtdienste über Mitternacht (z. B. 16:00–08:00).
 *
 * Deckt den kompletten UI-Fluss ab:
 * - Admin-Login über den echten Auth-Flow und Öffnen von /dienstplan
 * - Neue Schicht 16:00–08:00 über das Tagesdetail-Panel anlegen und speichern,
 *   ohne dass eine Fehlermeldung erscheint
 * - Prüfen, dass die Schicht nur am Starttag im Kalender erscheint und der
 *   Folgetag nicht fälschlich belegt ist
 * - Prüfen, dass das Zeit-Label die Spanne ohne (+1)-Zusatz zeigt
 *
 * Zusätzlich ein API-Integrationstest, der bestätigt, dass der gespeicherte
 * endTime am Folgetag liegt, wenn die Endzeit kleiner/gleich der Startzeit ist.
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

test.describe("Nachtdienst über Mitternacht (Admin, mobile)", () => {
  test("legt 16:00–08:00 an: nur am Starttag, ohne (+1)-Zusatz", async ({ page }) => {
    await loginAsAdmin(page);
    const assistant = await ensureAssistant(page);
    await ensureShiftModel(page);

    const mobile = await openCalendar(page);

    // Auf einen eigenen Zielmonat (+10, innerhalb des Premium-Vorausplanungs-
    // Fensters von 12 Monaten) navigieren; Leftovers werden vorab abgeräumt.
    for (let i = 0; i < 10; i++) {
      await page.getByTestId("next-month").click();
    }
    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );
    await clearUserShiftsAroundDay(page, year, month, 12, assistant.id);

    // Einen Tag mit garantiertem Folgetag im selben Monat auswählen.
    const day = 12;
    const cell = mobile.getByTestId(dayCellId(year, month, day));
    await selectDayCell(page, cell);
    await expect(cell).toHaveAttribute("data-selected", "true");

    // --- Nachtschicht über Mitternacht anlegen ----------------------------
    const uniqueNotes = `E2E Nachtschicht ${Date.now()}`;
    const startTime = "16:00";
    const endTime = "08:00";

    await mobile.getByTestId("add-shift").click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Neue Schicht anlegen")).toBeVisible();

    await dialog.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: assistant.name }).first().click();

    await dialog.getByTestId("shift-dialog-start").fill(startTime);
    await dialog.getByTestId("shift-dialog-end").fill(endTime);
    await dialog.getByTestId("shift-dialog-notes").fill(uniqueNotes);

    await dialog.getByTestId("shift-dialog-save").click();

    // Speichern erfolgreich → Dialog schließt, keine Fehlermeldung.
    await expect(dialog).toHaveCount(0);

    // Angelegte Schicht über die API auffinden (eindeutige Notiz).
    let created: ApiShift | undefined;
    await expect
      .poll(async () => {
        created = await findShiftByNotes(page, year, month, uniqueNotes);
        return created?.id ?? null;
      }, { message: "Angelegte Nachtschicht wurde nicht gefunden" })
      .not.toBeNull();
    expect(created).toBeTruthy();
    const shiftId = created!.id;

    // Gespeicherter endTime liegt am Folgetag (positive Dauer trotz 08:00 < 16:00).
    const startDate = new Date(created!.startTime);
    const endDate = new Date(created!.endTime);
    expect(endDate.getTime(), "endTime muss nach startTime liegen").toBeGreaterThan(
      startDate.getTime(),
    );
    expect(endDate.getDate(), "endTime muss am Folgetag liegen").toBe(day + 1);

    // --- Schicht erscheint nur am Starttag --------------------------------
    const badge = mobile.getByTestId(`shift-badge-${shiftId}`);
    await expect(badge).toBeVisible();
    // Zeit-Label enthält die Spanne (kein "(+1)"-Zusatz mehr auf der Kachel).
    await expect(badge).toContainText(`${startTime}–${endTime}`);
    await expect(badge).not.toContainText("(+1)");

    // Folgetag auswählen → die Schicht darf dort NICHT erscheinen.
    const nextCell = mobile.getByTestId(dayCellId(year, month, day + 1));
    await selectDayCell(page, nextCell);
    await expect(nextCell).toHaveAttribute("data-selected", "true");
    await expect(mobile.getByTestId(`shift-badge-${shiftId}`)).toHaveCount(0);

    // --- Aufräumen: Testschicht entfernen ---------------------------------
    const del = await page.request.delete(`/api/shifts/${shiftId}`);
    expect(del.ok(), "Aufräumen der Testschicht fehlgeschlagen").toBe(true);
  });

  test("API: endTime am Folgetag wird korrekt gespeichert und zurückgegeben", async ({ page }) => {
    await loginAsAdmin(page);
    const assistant = await ensureAssistant(page);
    await ensureShiftModel(page);

    // Eigener Zielmonat (+9, innerhalb des Premium-Vorausplanungs-Fensters von
    // 12 Monaten) und eindeutiger Tag; Leftovers werden vorab abgeräumt.
    const target = new Date();
    target.setDate(1);
    target.setMonth(target.getMonth() + 9);
    const tYear = target.getFullYear();
    const tMonth = target.getMonth() + 1;
    const ym = `${tYear}-${String(tMonth).padStart(2, "0")}`;
    const startTime = `${ym}-14T16:00:00.000Z`;
    const endTime = `${ym}-15T08:00:00.000Z`;
    const uniqueNotes = `E2E API Nachtschicht ${Date.now()}`;

    await clearUserShiftsAroundDay(page, tYear, tMonth, 14, assistant.id);

    const createRes = await page.request.post("/api/shifts", {
      data: {
        userId: assistant.id,
        startTime,
        endTime,
        type: "night",
        shiftModelId: null,
        notes: uniqueNotes,
      },
    });
    expect(
      createRes.ok(),
      `POST /api/shifts fehlgeschlagen: ${createRes.status()} ${await createRes.text()}`,
    ).toBe(true);
    const created = (await createRes.json()) as ApiShift;

    // Round-Trip: GET liefert dieselbe Schicht mit endTime am Folgetag.
    const getRes = await page.request.get(`/api/shifts/${created.id}`);
    expect(getRes.ok(), "GET /api/shifts/:id fehlgeschlagen").toBe(true);
    const fetched = (await getRes.json()) as ApiShift;

    const fetchedStart = new Date(fetched.startTime);
    const fetchedEnd = new Date(fetched.endTime);
    expect(fetchedEnd.getTime(), "endTime muss nach startTime liegen").toBeGreaterThan(
      fetchedStart.getTime(),
    );
    expect(
      fetchedEnd.getTime() - fetchedStart.getTime(),
      "Dauer muss 16 Stunden betragen",
    ).toBe(16 * 60 * 60 * 1000);

    // Aufräumen.
    const del = await page.request.delete(`/api/shifts/${created.id}`);
    expect(del.ok(), "Aufräumen der API-Testschicht fehlgeschlagen").toBe(true);
  });
});
