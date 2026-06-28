import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * E2E-Test für den 24h-Dienst.
 *
 * Ein 24h-Dienst entsteht im ShiftDialog, indem ein regulärer Dienst (z. B. das
 * Standard-Schichtmodell "24h Dienst") gewählt und Start- gleich Endzeit gesetzt
 * wird (08:00–08:00). handleSave wertet identische Zeiten als Tagesübergang und
 * legt das Ende auf den Folgetag, sodass eine 24h-Dauer entsteht. Der frühere
 * separate Legacy-Eintrag "24h-Dienst" im Anlegen-Dialog wurde entfernt (Task
 * #141), damit es nur noch einen 24h-Dienst gibt.
 *
 * Echter Anlegen-Pfad:
 * - Im Browser den Zieltag auswählen und "Schicht" anlegen öffnen.
 * - Assistent wählen, Dienst "24h Dienst" auswählen.
 * - Start- und Endzeit identisch setzen (08:00–08:00) und speichern → endIso =
 *   startIso + 24h (Folgetag).
 * - Prüfen, dass die Schicht nur am Starttag erscheint und das Zeit-Label den
 *   Folgetag-Hinweis "(+1)" trägt.
 *
 * Zusätzlich ein API-Round-Trip (Legacy-Typ full_day), der eine Dauer von
 * exakt 24 Stunden bestätigt.
 *
 * Verwendet eindeutige Testdaten (Zeitstempel im Notizfeld + weit in der Zukunft
 * liegender Monat), um Kollisionen mit Bestandsdaten und Parallel-Tests zu
 * vermeiden.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const HOUR_MS = 60 * 60 * 1000;

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
  await page.goto("/login");
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Stellt sicher, dass mindestens ein Assistent existiert, und gibt dessen Namen
 * zurück. Nutzt die authentifizierte Admin-Session.
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
 * Stellt sicher, dass ein Schichtmodell "24h Dienst" existiert (das beim
 * Registrieren standardmäßig geseedete Modell). Im isolierten Test-Stack wird
 * der Admin per Skript angelegt, daher ggf. einmalig erzeugen. Gibt Name und
 * Id zurück.
 */
async function ensure24hModel(page: Page): Promise<{ id: number; name: string }> {
  const name = "24h Dienst";
  const listRes = await page.request.get("/api/shift-models");
  expect(listRes.ok(), "GET /api/shift-models fehlgeschlagen").toBe(true);
  const models = (await listRes.json()) as { id: number; name: string }[];
  const existing = models.find((m) => m.name === name);
  if (existing) return { id: existing.id, name };

  const createRes = await page.request.post("/api/shift-models", {
    data: { name, color: "purple", valuationPercent: 100 },
  });
  expect(createRes.ok(), "Anlegen des 24h-Schichtmodells fehlgeschlagen").toBe(true);
  const created = (await createRes.json()) as { id: number };
  return { id: created.id, name };
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

/**
 * Entfernt alle Schichten des Assistenten, die am angegebenen Tag (oder am
 * Vortag, falls sie über Mitternacht laufen) beginnen. So bleibt der Zieltag
 * frei von Bestands-/Leftover-Schichten und das Seeden löst keine
 * Überschneidungs-Warnung aus.
 */
async function clearDayShifts(
  page: Page,
  year: number,
  month: number,
  day: number,
  userId: number,
): Promise<void> {
  const res = await page.request.get(`/api/shifts?month=${month}&year=${year}`);
  expect(res.ok(), "GET /api/shifts (cleanup) fehlgeschlagen").toBe(true);
  const shifts = (await res.json()) as ApiShift[];
  for (const s of shifts) {
    if (s.userId !== userId) continue;
    const start = new Date(s.startTime);
    if (start.getFullYear() !== year || start.getMonth() + 1 !== month) continue;
    if (start.getDate() === day || start.getDate() === day - 1) {
      const del = await page.request.delete(`/api/shifts/${s.id}`);
      expect(del.ok(), `Aufräumen vorhandener Schicht ${s.id} fehlgeschlagen`).toBe(true);
    }
  }
}

async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const mobile = page.getByTestId("dienstplan-mobile");
  await expect(mobile).toBeVisible();
  return mobile;
}

test.describe("24h-Dienst über den Folgetag (Admin, mobile)", () => {
  test("speichert 24h-Schicht: Endzeit = Start + 24h, nur am Starttag mit (+1)", async ({ page }) => {
    await loginAsAdmin(page);
    const assistant = await ensureAssistant(page);
    const model = await ensure24hModel(page);

    // Zielmonat = heute + 21 Monate (anderer Offset als die Nachtdienst-Tests),
    // damit Kollisionen mit Bestandsschichten und parallelen Tests vermieden
    // werden. Vorab berechnet, damit die Schicht VOR dem Laden des Kalenders
    // existiert (sonst kennt der erste Fetch sie nicht und das Badge fehlt).
    const monthsAhead = 21;
    const base = new Date();
    const target = new Date(base.getFullYear(), base.getMonth() + monthsAhead, 1);
    const year = target.getFullYear();
    const month = target.getMonth() + 1;

    // Tag mit garantiertem Folgetag im selben Monat.
    const day = 10;

    const uniqueNotes = `E2E 24h-Dienst ${Date.now()}`;
    const startTime = "08:00";

    // Zieltag (und Folgetag) von Leftover-/Bestandsschichten befreien, damit das
    // Anlegen keine Überschneidungs-Warnung auslöst.
    await clearDayShifts(page, year, month, day, assistant.id);
    await clearDayShifts(page, year, month, day + 1, assistant.id);

    // --- Kalender öffnen und zum Zielmonat navigieren ----------------------
    const mobile = await openCalendar(page);
    for (let i = 0; i < monthsAhead; i++) {
      await page.getByTestId("next-month").click();
    }
    // Sanity: Navigation hat den vorab berechneten Monat erreicht.
    const shown = parseMonthLabel(await page.getByTestId("month-label").innerText());
    expect(shown.year, "Navigierter Monat weicht ab").toBe(year);
    expect(shown.month, "Navigierter Monat weicht ab").toBe(month);

    // --- Zieltag auswählen und Anlegen-Dialog öffnen -----------------------
    const cell = mobile.getByTestId(dayCellId(year, month, day));
    await cell.click();
    await expect(cell).toHaveAttribute("data-selected", "true");

    await mobile.getByTestId("add-shift").click();

    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Neue Schicht anlegen")).toBeVisible();

    // --- Assistent und Dienst "24h Dienst" wählen (echter Anlegen-Pfad) ----
    await dialog.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: assistant.name }).first().click();

    await dialog.getByTestId("shift-dialog-type").click();
    await page.getByRole("option", { name: model.name, exact: true }).click();

    // Gleiche Start- und Endzeit (08:00–08:00) wird als 24h-Dienst gewertet:
    // handleSave legt das Ende auf den Folgetag, sodass eine 24h-Dauer entsteht.
    await dialog.getByTestId("shift-dialog-start").fill(startTime);
    await dialog.getByTestId("shift-dialog-end").fill(startTime);
    await dialog.getByTestId("shift-dialog-notes").fill(uniqueNotes);

    // Speichern → endIso = startIso + 24h (Folgetag).
    await dialog.getByTestId("shift-dialog-save").click();

    // Speichern erfolgreich → Dialog schließt, keine Fehlermeldung.
    await expect(dialog).toHaveCount(0);

    // --- API-Round-Trip: Typ full_day, Dauer exakt 24h, Ende am Folgetag ---
    let created: ApiShift | undefined;
    await expect
      .poll(async () => {
        created = await findShiftByNotes(page, year, month, uniqueNotes);
        if (!created) return null;
        return new Date(created.endTime).getTime() - new Date(created.startTime).getTime();
      }, { message: "Neue 24h-Schicht wurde nicht mit 24h-Dauer angelegt" })
      .toBe(24 * HOUR_MS);

    const shiftId = created!.id;
    expect(created!.type, "Typ muss work (Schichtmodell) sein").toBe("work");
    const start = new Date(created!.startTime);
    const end = new Date(created!.endTime);
    expect(end.getTime(), "endTime muss nach startTime liegen").toBeGreaterThan(start.getTime());
    expect(end.getDate(), "endTime muss am Folgetag liegen").toBe(day + 1);

    // --- Schicht erscheint nur am Starttag, mit (+1)-Hinweis ---------------
    const badge = mobile.getByTestId(`shift-badge-${shiftId}`);
    await expect(badge).toBeVisible();
    // 24h-Schicht: Start- und Endzeit identisch (08:00–08:00) + Folgetag-Hinweis.
    await expect(badge).toContainText(`${startTime}–${startTime}`);
    await expect(badge).toContainText("(+1)");

    // Folgetag auswählen → die Schicht darf dort NICHT erscheinen.
    const nextCell = mobile.getByTestId(dayCellId(year, month, day + 1));
    await nextCell.click();
    await expect(nextCell).toHaveAttribute("data-selected", "true");
    await expect(mobile.getByTestId(`shift-badge-${shiftId}`)).toHaveCount(0);

    // --- Aufräumen ---------------------------------------------------------
    const del = await page.request.delete(`/api/shifts/${shiftId}`);
    expect(del.ok(), "Aufräumen der Testschicht fehlgeschlagen").toBe(true);
  });

  test("API: 24h-Dienst wird mit exakt 24 Stunden Dauer gespeichert", async ({ page }) => {
    await loginAsAdmin(page);
    const assistant = await ensureAssistant(page);

    // Weit in der Zukunft, eindeutiger Tag → keine Kollision.
    const baseYear = new Date().getFullYear() + 4;
    const startTime = `${baseYear}-05-20T08:00:00.000Z`;
    const endTime = `${baseYear}-05-21T08:00:00.000Z`;
    const uniqueNotes = `E2E API 24h-Dienst ${Date.now()}`;

    const createRes = await page.request.post("/api/shifts", {
      data: {
        userId: assistant.id,
        startTime,
        endTime,
        type: "full_day",
        shiftModelId: null,
        notes: uniqueNotes,
      },
    });
    expect(
      createRes.ok(),
      `POST /api/shifts fehlgeschlagen: ${createRes.status()} ${await createRes.text()}`,
    ).toBe(true);
    const created = (await createRes.json()) as ApiShift;

    // Round-Trip: GET liefert dieselbe Schicht mit 24h-Dauer am Folgetag.
    const getRes = await page.request.get(`/api/shifts/${created.id}`);
    expect(getRes.ok(), "GET /api/shifts/:id fehlgeschlagen").toBe(true);
    const fetched = (await getRes.json()) as ApiShift;

    const fetchedStart = new Date(fetched.startTime);
    const fetchedEnd = new Date(fetched.endTime);
    expect(fetched.type, "Typ muss full_day sein").toBe("full_day");
    expect(
      fetchedEnd.getTime() - fetchedStart.getTime(),
      "Dauer muss exakt 24 Stunden betragen",
    ).toBe(24 * HOUR_MS);
    expect(fetchedEnd.getUTCDate(), "endTime muss am Folgetag liegen").toBe(
      fetchedStart.getUTCDate() + 1,
    );

    // Aufräumen.
    const del = await page.request.delete(`/api/shifts/${created.id}`);
    expect(del.ok(), "Aufräumen der API-Testschicht fehlgeschlagen").toBe(true);
  });
});
