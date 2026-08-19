import { test, expect, type Page, type Locator } from "@playwright/test";
import { startSelectionMode } from "./helpers/header";

/**
 * E2E-Test: Massen-Eintragen und Massen-Löschen über mehrere Tage.
 *
 * Der Auswahl-Modus ("Mehrfachauswahl") markiert mehrere Tage und legt/
 * löscht dann Schichten für alle ausgewählten Tage in einer Schleife. Dieser
 * Test fängt Regressionen ab, bevor sie Nutzer treffen — etwa wenn die
 * Floating-Action-Bar den Zähler falsch anzeigt, der Mehrfach-Anlegen-Dialog
 * nicht alle Tage schreibt, der BulkDeleteDialog die Ziel-Schichten verfehlt
 * oder ein Monatswechsel die Auswahl nicht mehr korrekt leert.
 *
 * Deckt ab:
 * - Auswahl-Modus aktivieren (toggle-selection-mode) → Spalten-Header (Desktop)
 *   werden auswählbar; mehrere Tage anklicken markiert sie (data-selected).
 * - Floating-Bar erscheint mit korrektem Zähler (bulk-selected-count).
 * - Schichten für ALLE gewählten Tage anlegen (Mehrfach-Dialog, Abwesenheit
 *   "Urlaub" — kommt ohne Schichtmodell aus, daher unabhängig vom Seed-Stand).
 * - Auswahl wird nach erfolgreichem Anlegen geleert (Bar weg, Modus beendet).
 * - Über die API exakt so viele Schichten wie gewählte Tage angelegt; Badges
 *   im Kalender sichtbar.
 * - Wieder alle Tage auswählen und per BulkDeleteDialog löschen
 *   (bulk-delete-count stimmt, bulk-delete-confirm); Badges verschwinden, API
 *   liefert keine Schichten mehr.
 * - Negativfall: Monatswechsel im Auswahl-Modus leert die Auswahl (Bar weg,
 *   Modus beendet), sodass Massenaktionen nie auf unsichtbare Tage wirken.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Desktop-Viewport: der Auswahl-Modus über klickbare Spalten-Header
// (col-header-*) existiert nur in der Tabellenansicht (md:block).
test.use({ viewport: { width: 1280, height: 900 } });

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

/** "YYYY-MM-DD" für den n-ten Tag des angezeigten Monats. */
function dateKey(year: number, month: number, dayOfMonth: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

async function loginAsAdmin(page: Page): Promise<void> {
  // Programmatische Anmeldung über die API: page.request teilt den Cookie-Jar
  // mit dem Browser, dadurch ist /api/auth/me beim ersten Laden sofort 200 und
  // der Vite-Dev-Auto-Login greift nie (dev- UND prod-tauglich).
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Admin-Login fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

/** Legt einen dedizierten Test-Assistenten an (kollisionsfrei). */
async function createAssistant(page: Page): Promise<{ id: number; name: string }> {
  const unique = Date.now();
  const res = await page.request.post("/api/users", {
    data: {
      name: `E2E Bulk ${unique}`,
      email: `e2e.bulk.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(res.ok(), `Anlegen des Test-Assistenten fehlgeschlagen (${res.status()})`).toBe(true);
  return (await res.json()) as { id: number; name: string };
}

/** Holt alle Schichten eines Monats für genau diesen Assistenten. */
async function shiftsForAssistant(
  page: Page,
  year: number,
  month: number,
  userId: number,
): Promise<ApiShift[]> {
  const res = await page.request.get(`/api/shifts?month=${month}&year=${year}`);
  expect(res.ok(), `GET /api/shifts fehlgeschlagen (${res.status()})`).toBe(true);
  const all = (await res.json()) as ApiShift[];
  return all.filter((s) => s.userId === userId);
}

async function openDesktopCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const desktop = page.getByTestId("dienstplan-desktop");
  await expect(desktop).toBeVisible();
  // Tabellenansicht ist auf dem Desktop der Standard.
  await expect(page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-table")).toHaveAttribute("data-active", "true");
  return desktop;
}

test("Massen-Eintragen und Massen-Löschen über mehrere Tage funktioniert", async ({ page }) => {
  // Mehrstufiger UI-Flow (Massen-Anlegen + Massen-Loeschen) — unter Volllast
  // der Gesamtsuite reichen die 30s-Defaults nicht zuverlaessig.
  test.setTimeout(60000);
  await loginAsAdmin(page);
  const assistant = await createAssistant(page);
  const createdShiftIds: number[] = [];

  try {
    await openDesktopCalendar(page);

    // Spec-eigener Zielmonat (+11, innerhalb des Premium-Vorausplanungs-
    // Fensters von 12 Monaten): Da der „Alle Assistenten"-Massen-Löschen alle
    // Schichten der gewählten Tage zählt, muss dieser Monat kollisionsfrei zu
    // anderen Specs sein. +8 teilt sich shift-dialog (dort Tag 16), +4/5/10
    // sind ebenfalls belegt — +11 ist exklusiv für diesen Ablauf. (Vor dem
    // Auswahl-Modus — Monatswechsel würde die Auswahl ohnehin leeren.)
    for (let i = 0; i < 11; i++) {
      await page.getByTestId("next-month").click();
    }
    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    const days = [6, 7, 8];

    // --- Auswahl-Modus aktivieren und drei Tage wählen --------------------
    await startSelectionMode(page);
    for (const d of days) {
      const header = page.getByTestId(`col-header-${dateKey(year, month, d)}`);
      await header.click();
      await expect(header).toHaveAttribute("data-selected", "true");
    }

    // Floating-Bar erscheint mit korrektem Zähler.
    const bar = page.getByTestId("bulk-action-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("3 Tage ausgewählt");

    // --- Schichten für alle gewählten Tage anlegen ------------------------
    await page.getByTestId("bulk-create-open").click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("shift-dialog-bulk-summary")).toContainText("3 Tage ausgewählt");

    // Assistent auswählen.
    await dialog.getByTestId("shift-dialog-user").click();
    await page.getByRole("option", { name: assistant.name }).first().click();

    // Typ "Urlaub" (Abwesenheit) — braucht kein Schichtmodell, daher robust
    // gegenüber dem Seed-Stand der Test-DB.
    await dialog.getByTestId("shift-dialog-type").click();
    await page.getByRole("option", { name: "Urlaub" }).first().click();

    await dialog.getByTestId("shift-dialog-save").click();

    // Dialog schließt; Auswahl wird geleert, Modus beendet. Urlaubs-Anlagen
    // sind serverseitig langsam (Urlaubskonto-Recalc, ~5s+/Tag) — großzügig
    // warten statt der 5s-Default-Frist.
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("bulk-action-bar")).toHaveCount(0);
    await expect(page.getByTestId("toggle-selection-mode")).toHaveCount(0);

    // Genau drei Schichten angelegt (eine pro gewähltem Tag).
    let created: ApiShift[] = [];
    await expect
      .poll(async () => {
        created = await shiftsForAssistant(page, year, month, assistant.id);
        return created.length;
      }, { message: "Es wurden nicht drei Schichten angelegt" })
      .toBe(3);
    for (const s of created) createdShiftIds.push(s.id);

    // Abwesenheiten (hier: Urlaub) erscheinen NICHT als Eintrag in der
    // Personenzeile der Tabelle — die Tabelle zeigt nur reguläre Dienste.
    // Sichtbarer Nachweis ist die Übersicht "Team-Abwesenheiten": die drei
    // aufeinanderfolgenden Urlaubstage werden dort zu einem Zeitraum gebündelt.
    const desktop = page.getByTestId("dienstplan-desktop");
    const absenceOverview = page.getByTestId("team-absence-overview");
    await expect(absenceOverview.getByTestId("team-absence-count")).toContainText(
      /Zeitraum|Zeiträume/,
    );
    await absenceOverview.getByTestId("team-absence-toggle").click();
    const absenceRow = absenceOverview
      .getByTestId("team-absence-row")
      .filter({ hasText: assistant.name });
    await expect(absenceRow, "Urlaubs-Zeitraum muss in der Abwesenheits-Übersicht stehen").toHaveCount(1);
    await expect(absenceRow).toContainText("Urlaub");
    await expect(absenceRow).toContainText("3 Tage");
    await absenceOverview.getByTestId("team-absence-toggle").click();

    // --- Wieder alle Tage auswählen und per BulkDeleteDialog löschen ------
    await startSelectionMode(page);
    for (const d of days) {
      const header = page.getByTestId(`col-header-${dateKey(year, month, d)}`);
      await header.click();
      await expect(header).toHaveAttribute("data-selected", "true");
    }
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("3 Tage ausgewählt");

    await page.getByTestId("bulk-delete-open").click();
    const delDialog = page.getByTestId("bulk-delete-dialog");
    await expect(delDialog).toBeVisible();
    // Standard ist "Alle Assistenten" → alle drei Schichten sind Ziel.
    await expect(delDialog.getByTestId("bulk-delete-count")).toContainText("3 Einträge");

    await delDialog.getByTestId("bulk-delete-confirm").click();

    // Dialog schließt; Auswahl geleert, Modus beendet (Massen-Löschen inkl.
    // Urlaubskonto-Recalc kann >5s dauern).
    await expect(delDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("bulk-action-bar")).toHaveCount(0);

    // Abwesenheits-Übersicht ist wieder leer; API liefert keine Schichten mehr.
    await expect(absenceOverview.getByTestId("team-absence-count")).toContainText(
      "keine aktuell",
      { timeout: 15_000 },
    );
    for (const s of created) {
      await expect(desktop.getByTestId(`shift-badge-${s.id}`)).toHaveCount(0);
    }
    await expect
      .poll(async () => (await shiftsForAssistant(page, year, month, assistant.id)).length, {
        message: "Schichten wurden nicht gelöscht",
      })
      .toBe(0);
    // Erfolgreich gelöscht — Cleanup unten muss nichts mehr tun.
    createdShiftIds.length = 0;
  } finally {
    for (const id of createdShiftIds) {
      await page.request.delete(`/api/shifts/${id}`);
    }
    await page.request.delete(`/api/users/${assistant.id}`);
  }
});

test.describe("Aktionsleiste auf schmalem Handy-Viewport", () => {
  // Schmaler Handy-Viewport (360px): Die Floating-Action-Bar muss umbrechen
  // duerfen, statt seitlich aus dem Bildschirm zu ragen.
  test.use({ viewport: { width: 360, height: 740 } });

  test("Alle vier Aktionen und der Zaehler sind auf 360px erreichbar", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
    await expect(page.getByTestId("dienstplan-mobile")).toBeVisible();

    const { year, month } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    // In die Listenansicht wechseln (Mobil-Default ist das Monatsgitter) —
    // dort sind die agenda-day-Zellen im Auswahl-Modus anklickbar.
    await page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list").click();

    // Auswahl-Modus an, drei Tage in der Listenansicht waehlen (nur Auswahl,
    // keine Schreiboperation — daher kollisionsfrei zu anderen Specs).
    await startSelectionMode(page);
    // agenda-day-Zellen existieren dreifach (Mobil-Listenansicht + persistente
    // Wochen-Listen mobil/desktop) — auf den Mobil-Container scopen, sonst
    // bricht der Strict Mode mit "resolved to 3 elements" ab.
    const mobileList = page.getByTestId("dienstplan-mobile");
    for (const d of [6, 7, 8]) {
      const cell = mobileList.getByTestId(`agenda-day-${dateKey(year, month, d)}`);
      await cell.scrollIntoViewIfNeeded();
      await cell.getByRole("button").first().click();
      await expect(cell).toHaveAttribute("data-selected", "true");
    }

    const bar = page.getByTestId("bulk-action-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("bulk-selected-count")).toHaveText("3 Tage ausgewählt");

    // Die Leiste selbst passt vollstaendig in den Viewport.
    const viewportWidth = 360;
    const barBox = await bar.boundingBox();
    expect(barBox, "bulk-action-bar hat keine BoundingBox").not.toBeNull();
    expect(barBox!.x).toBeGreaterThanOrEqual(0);
    expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(viewportWidth + 0.5);

    // Jede der vier Aktionen ist sichtbar und liegt horizontal im Viewport.
    for (const testId of ["bulk-create-open", "bulk-edit-open", "bulk-delete-open", "bulk-cancel"]) {
      const btn = page.getByTestId(testId);
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box, `${testId} hat keine BoundingBox`).not.toBeNull();
      expect(box!.x, `${testId} ragt links hinaus`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${testId} ragt rechts hinaus`).toBeLessThanOrEqual(viewportWidth + 0.5);
    }

    // Abbrechen funktioniert und raeumt die Auswahl auf.
    await page.getByTestId("bulk-cancel").click();
    await expect(bar).toHaveCount(0);
  });
});

test("Monatswechsel im Auswahl-Modus leert die Auswahl", async ({ page }) => {
  await loginAsAdmin(page);
  await openDesktopCalendar(page);

  const { year, month } = parseMonthLabel(
    await page.getByTestId("month-label").innerText(),
  );

  // Auswahl-Modus an, zwei Tage wählen.
  await startSelectionMode(page);
  for (const d of [12, 13]) {
    await page.getByTestId(`col-header-${dateKey(year, month, d)}`).click();
  }
  await expect(page.getByTestId("bulk-selected-count")).toHaveText("2 Tage ausgewählt");

  // Monatswechsel: Auswahl muss verworfen werden, Modus beendet — sonst
  // wirkten Massenaktionen auf nicht mehr sichtbare Tage.
  await page.getByTestId("next-month").click();

  await expect(page.getByTestId("bulk-action-bar")).toHaveCount(0);
  await expect(page.getByTestId("toggle-selection-mode")).toHaveCount(0);

  // Zurück zum Ausgangsmonat: die vormals gewählten Tage sind nicht mehr
  // ausgewählt (Auswahl-Modus ist aus, daher gibt es keine col-header mehr).
  await page.getByTestId("prev-month").click();
  await expect(page.getByTestId("month-label")).toHaveText(MONTHS_DE[month - 1] + " " + year);
  await expect(page.getByTestId("bulk-action-bar")).toHaveCount(0);
});
