import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * E2E-Test: Beim Öffnen eines 24h-DIENSTES (identische Start-/Endzeit, z. B.
 * 08:00–08:00; das Ende liegt per `startDate + 24h` exakt einen Tag später)
 * im Bearbeiten-Modus werden Datum (Starttag) und Startzeit korrekt vorbelegt,
 * und das Endzeit-Feld wird als deaktiviertes "(auto)"-Feld mit derselben
 * Uhrzeit wie der Start angezeigt. Ein Speichern ohne Änderung verschiebt die
 * Zeiten NICHT — das Ende bleibt exakt 24h nach dem Start (am Folgetag).
 *
 * Regressionsschutz für den dritten heiklen Prefill-Fall:
 * - Task #99 sichert den Prefill einer regulären Schicht (gleicher Tag) ab,
 * - Task #118 den Prefill einer Nachtschicht über Mitternacht (22:00–06:00),
 * - dieser Test den 24h-Dienst (`legacy:full_day` / Legacy-Typ `full_day`).
 *
 * Der 24h-Zweig (`is24h`) ist besonders, weil das Ende NICHT aus dem Endzeit-
 * Feld gelesen, sondern in `buildTimes` als `startDate + 24h` berechnet wird und
 * das Endzeit-Feld deaktiviert ist (Anzeige = Startzeit). Ein Fehler in der
 * 24h-Auflösung oder im Prefill (`initialSelection` → `legacy:full_day`,
 * `toDateString`/`toTimeString`) würde nur in diesem Sonderfall auffallen.
 *
 * Ablauf:
 * - Admin-Login über den echten Auth-Flow
 * - Assistent sicherstellen, 24h-Dienst (Typ `full_day`) direkt per API anlegen
 *   (im Anlege-Dialog gibt es bewusst keine `full_day`-Option — der Typ entsteht
 *   nur über Bestandsdaten/Legacy und wird im Bearbeiten-Dialog als 24h erkannt)
 * - Schicht im Kalender öffnen (Bearbeiten-Modus), Prefill prüfen
 * - Ohne Änderung speichern und per API verifizieren (keine Drift, Ende = +24h)
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
  await page.goto("/login");
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/$/);
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

async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const mobile = page.getByTestId("dienstplan-mobile");
  await expect(mobile).toBeVisible();
  return mobile;
}

async function navigateForwardMonths(page: Page, count: number): Promise<{ year: number; month: number }> {
  for (let i = 0; i < count; i++) {
    await page.getByTestId("next-month").click();
  }
  return parseMonthLabel(await page.getByTestId("month-label").innerText());
}

test.describe("ShiftDialog: Bearbeiten belegt 24h-Dienst korrekt vor (Admin, mobile)", () => {
  test("Datum/Start sind vorbelegt, Ende-Feld ist deaktiviert (= Start) und Ende bleibt nach unverändertem Speichern exakt +24h", async ({ page }) => {
    await loginAsAdmin(page);
    const assistant = await ensureAssistant(page);

    const mobile = await openCalendar(page);

    // In einen weit in der Zukunft liegenden Monat navigieren (Kollisionsschutz).
    const { year, month } = await navigateForwardMonths(page, 23);

    // Tag 16 ist in jedem Monat vorhanden; der Folgetag (Ende) existiert sicher.
    const day = 16;
    const expectedDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const startTime = "08:00";

    // --- 24h-Dienst direkt per API anlegen (Typ full_day) ------------------
    // Start = Tag 16 08:00, Ende = exakt 24h später (Folgetag 08:00). Die ISO-
    // Berechnung spiegelt die Dialog-Logik (buildIso / startDate + 24h) wider.
    const startIso = new Date(`${expectedDate}T${startTime}:00`).toISOString();
    const endIso = new Date(new Date(startIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const uniqueNotes = `E2E Prefill 24h ${Date.now()}`;

    const createRes = await page.request.post("/api/shifts", {
      data: {
        userId: assistant.id,
        startTime: startIso,
        endTime: endIso,
        type: "full_day",
        notes: uniqueNotes,
      },
    });
    expect(createRes.ok(), "Anlegen des 24h-Dienstes per API fehlgeschlagen").toBe(true);
    const created = (await createRes.json()) as ApiShift;
    const shiftId = created.id;
    const originalStart = created.startTime;
    const originalEnd = created.endTime;

    // Vorbedingung: Der angelegte Dienst umfasst exakt 24h (Ende am Folgetag).
    expect(
      new Date(originalEnd).getTime() - new Date(originalStart).getTime(),
      "24h-Dienst muss exakt 24 Stunden umfassen (Ende am Folgetag)",
    ).toBe(24 * 60 * 60 * 1000);

    // --- Kalender für den Zielmonat neu laden (frischer Fetch) --------------
    // Der Dienst wurde nach dem ersten Monats-Fetch per API angelegt; ein
    // Wechsel vor/zurück erzwingt einen neuen Query für denselben Monat.
    await page.getByTestId("prev-month").click();
    await page.getByTestId("next-month").click();
    expect(parseMonthLabel(await page.getByTestId("month-label").innerText())).toEqual({ year, month });

    // --- Schicht im Bearbeiten-Modus öffnen --------------------------------
    const badge = mobile.getByTestId(`shift-badge-${shiftId}`);
    await expect(badge).toBeVisible();
    await badge.click();

    const editDialog = page.getByTestId("shift-dialog");
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("Schicht bearbeiten")).toBeVisible();

    // --- Prefill prüfen: Datum = STARTTAG, Startzeit = 08:00 ---------------
    await expect(
      editDialog.getByTestId("shift-dialog-date"),
      "Datum muss der Starttag des 24h-Dienstes sein (nicht der Folgetag des Endes)",
    ).toHaveValue(expectedDate);
    await expect(
      editDialog.getByTestId("shift-dialog-start"),
      "Startzeit muss aus der Schicht vorbelegt sein",
    ).toHaveValue(startTime);

    // --- 24h-Sonderfall: Endzeit-Feld ist deaktiviert und = Startzeit ------
    const endField = editDialog.getByTestId("shift-dialog-end");
    await expect(
      endField,
      "Endzeit-Feld muss im 24h-Dienst deaktiviert sein (Ende wird automatisch berechnet)",
    ).toBeDisabled();
    await expect(
      endField,
      "Das deaktivierte Endzeit-Feld zeigt im 24h-Dienst dieselbe Uhrzeit wie der Start",
    ).toHaveValue(startTime);
    await expect(
      editDialog.getByText("24h nach Startzeit"),
      "Der Hinweis '24h nach Startzeit' muss im 24h-Dienst sichtbar sein",
    ).toBeVisible();

    // --- Ohne Änderung speichern -------------------------------------------
    await editDialog.getByTestId("shift-dialog-save").click();
    await expect(editDialog).toHaveCount(0);

    // --- Verifikation: keine Zeit-Drift, Ende weiterhin exakt +24h ---------
    let afterSave: ApiShift | undefined;
    await expect
      .poll(async () => {
        const res = await page.request.get(`/api/shifts/${shiftId}`);
        if (!res.ok()) return null;
        afterSave = (await res.json()) as ApiShift;
        return afterSave.id;
      }, { message: "24h-Dienst nach dem Speichern nicht gefunden" })
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
    // Der 24h-Charakter muss erhalten bleiben: Ende exakt 24h nach Start.
    expect(
      new Date(afterSave!.endTime).getTime() - new Date(afterSave!.startTime).getTime(),
      "endTime muss nach dem Speichern weiterhin exakt 24h nach startTime liegen",
    ).toBe(24 * 60 * 60 * 1000);

    // --- Aufräumen ---------------------------------------------------------
    const del = await page.request.delete(`/api/shifts/${shiftId}`);
    expect(del.ok(), "Aufräumen des Test-24h-Dienstes fehlgeschlagen").toBe(true);
  });
});
