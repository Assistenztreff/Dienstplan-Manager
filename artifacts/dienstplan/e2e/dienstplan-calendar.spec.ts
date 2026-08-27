import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { selectDayCell } from "./helpers/shifts";

/**
 * E2E-Test für den Dienstplan-Kalender nach Admin-Login.
 *
 * Deckt ab:
 * - Admin-Login über den echten Auth-Flow und Öffnen von /dienstplan
 * - Umschalter Liste/Monat (mobile Ansicht)
 * - Assistenten-Filter (Auswahl + Zurücksetzen)
 * - Tagesauswahl im Monatsgitter
 * - Wochentags-Offset-Logik der Monatsanfänge über mehrere Monate
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Parst das Label "MMMM yyyy" (z. B. "Juni 2026") in Jahr und 0-basierten Monat. */
function parseMonthLabel(text: string): { year: number; monthIndex: number } {
  const parts = text.trim().split(/\s+/);
  const monthIndex = MONTHS_DE.indexOf(parts[0]);
  const year = Number(parts[1]);
  expect(monthIndex, `Unbekannter Monatsname in "${text}"`).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(year), `Ungültiges Jahr in "${text}"`).toBe(true);
  return { year, monthIndex };
}

/** Erwartete Anzahl leerer Vorlauf-Zellen (Montag = erster Wochentag). */
function expectedOffset(year: number, monthIndex: number): number {
  const firstOfMonth = new Date(year, monthIndex, 1);
  return (firstOfMonth.getDay() + 6) % 7;
}

/** data-testid einer Tageszelle für den n-ten Tag des angezeigten Monats. */
function dayCellId(year: number, monthIndex: number, dayOfMonth: number): string {
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `day-cell-${year}-${mm}-${dd}`;
}

/** data-testid der zugehörigen Zeile in der Wochen-Liste (schedule-list). */
function agendaDayId(year: number, monthIndex: number, dayOfMonth: number): string {
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(dayOfMonth).padStart(2, "0");
  return `agenda-day-${year}-${mm}-${dd}`;
}

async function loginAsAdmin(page: Page): Promise<void> {
  // Delegiert an den gemeinsamen Helper, der den Vite-Dev-Auto-Login
  // toleriert (kein Login-Formular) und im Prod-Build das Formular ausfüllt.
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * Stellt deterministisch sicher, dass mindestens ein Assistent existiert,
 * damit der Assistenten-Filter im Kalender gerendert wird. Nutzt die
 * authentifizierte Session des bereits eingeloggten Admins (page.request
 * teilt die Cookies des Browser-Kontexts).
 */
async function ensureAssistantExists(page: Page): Promise<void> {
  const listRes = await page.request.get("/api/users?role=assistant");
  expect(listRes.ok(), "GET /api/users?role=assistant fehlgeschlagen").toBe(true);
  const assistants = (await listRes.json()) as unknown[];
  if (assistants.length > 0) return;

  const unique = Date.now();
  const createRes = await page.request.post("/api/users", {
    data: {
      name: `E2E Assistent ${unique}`,
      email: `e2e.assistant.${unique}@dienstplan.test`,
      role: "assistant",
    },
  });
  expect(createRes.ok(), "Anlegen des Test-Assistenten fehlgeschlagen").toBe(true);
}

async function openCalendar(page: Page): Promise<Locator> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  const mobile = page.getByTestId("dienstplan-mobile");
  await expect(mobile).toBeVisible();
  return mobile;
}

test.describe("Dienstplan-Kalender (Admin, mobile)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    // Deterministische Fixture: garantiert mindestens einen Assistenten.
    await ensureAssistantExists(page);
  });

  test("Login öffnet den Kalender mit Monatsansicht als Standard", async ({ page }) => {
    const mobile = await openCalendar(page);

    // Monatslabel vorhanden und parsebar.
    const label = await page.getByTestId("month-label").innerText();
    parseMonthLabel(label);

    // Standardmäßig ist die Monatsansicht aktiv.
    await expect(page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-grid")).toHaveAttribute("data-active", "true");
    await expect(mobile.getByTestId("month-grid")).toBeVisible();

    // Wochentags-Kopfzeile Mo..So.
    for (const wd of ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]) {
      await expect(mobile.getByText(wd, { exact: true }).first()).toBeVisible();
    }
  });

  test("Umschalter wechselt zwischen Liste und Monat", async ({ page }) => {
    const mobile = await openCalendar(page);

    // In die Listenansicht wechseln: Monatsgitter verschwindet.
    await page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list").click();
    await expect(page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list")).toHaveAttribute("data-active", "true");
    await expect(mobile.getByTestId("month-grid")).toHaveCount(0);

    // Zurück zur Monatsansicht: Gitter wieder sichtbar. Die Wochen-Liste
    // (schedule-list) steht seit der UI-Vereinheitlichung (26.08.2026)
    // UNABHÄNGIG vom Liste/Monat-Umschalter immer unterhalb — sie ist daher
    // kein Signal mehr für DIESEN Umschalter, nur das Gitter selbst ist es.
    await page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-grid").click();
    await expect(page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-grid")).toHaveAttribute("data-active", "true");
    await expect(mobile.getByTestId("month-grid")).toBeVisible();
  });

  test("Assistenten-Filter wählt aus und setzt zurück", async ({ page }) => {
    await openCalendar(page);

    // Der Assistenten-Filter ist ein kompaktes Select in der Kopfzeile.
    const trigger = page.getByTestId("assistant-select");
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText("Alle Assistenzkräfte");

    // Ersten konkreten Assistenten auswählen (erste Option nach "Alle").
    await trigger.click();
    const firstAssistant = page
      .locator('[data-testid^="assistant-option-"]:not([data-testid="assistant-option-all"])')
      .first();
    await firstAssistant.click();
    // Trigger zeigt jetzt einen konkreten Assistenten statt "Alle Assistenzkräfte".
    await expect(trigger).not.toContainText("Alle Assistenzkräfte");

    // Auf "Alle" zurücksetzen.
    await trigger.click();
    await page.getByTestId("assistant-option-all").click();
    await expect(trigger).toContainText("Alle Assistenzkräfte");
  });

  test("Tagesauswahl im Monatsgitter markiert die Zeile in der Wochen-Liste", async ({ page }) => {
    // Seit der UI-Vereinheitlichung (26.08.2026) engt die Tagesauswahl die
    // Wochen-Liste NICHT mehr ein (Standard-Zeitraum bleibt „Dieser Monat") —
    // stattdessen bekommt die Zeile des gewählten Tages einen Anker-Rahmen
    // (data-anchor), analog zur Desktop-Tabellenansicht.
    const mobile = await openCalendar(page);
    const { year, monthIndex } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    // Standard-Zeitraum ist seit 27.08.2026 „Heute" — fuer die Anker-Pruefung
    // an zwei verschiedenen Tagen braucht die Liste den Monatsblick.
    await page.getByTestId("schedule-list-range-menu").click();
    await page.getByRole("option", { name: "Dieser Monat" }).click();

    const cell15 = mobile.getByTestId(dayCellId(year, monthIndex, 15));
    await selectDayCell(page, cell15);
    await expect(cell15).toHaveAttribute("data-selected", "true");
    const agendaDay15 = page.getByTestId(agendaDayId(year, monthIndex, 15));
    await expect(agendaDay15).toHaveAttribute("data-anchor", "true");

    const cell20 = mobile.getByTestId(dayCellId(year, monthIndex, 20));
    await selectDayCell(page, cell20);
    await expect(cell20).toHaveAttribute("data-selected", "true");
    await expect(cell15).toHaveAttribute("data-selected", "false");
    await expect(agendaDay15).toHaveAttribute("data-anchor", "false");
    const agendaDay20 = page.getByTestId(agendaDayId(year, monthIndex, 20));
    await expect(agendaDay20).toHaveAttribute("data-anchor", "true");
  });

  test("Monatsnavigation: Wochentags-Offset stimmt über mehrere Monate", async ({ page }) => {
    const mobile = await openCalendar(page);

    // Mindestens fünf aufeinanderfolgende Monate prüfen, damit unterschiedliche
    // Wochentage als Monatsanfang abgedeckt sind.
    const seenOffsets = new Set<number>();
    for (let i = 0; i < 5; i++) {
      const { year, monthIndex } = parseMonthLabel(
        await page.getByTestId("month-label").innerText(),
      );
      const offset = expectedOffset(year, monthIndex);
      seenOffsets.add(offset);

      const grid = mobile.getByTestId("month-grid");
      await expect(grid).toBeVisible();

      // Anzahl der leeren Vorlauf-Zellen muss dem berechneten Offset entsprechen.
      await expect(grid.getByTestId("month-grid-blank")).toHaveCount(offset);

      // Der Erste des Monats existiert als Tageszelle.
      await expect(mobile.getByTestId(dayCellId(year, monthIndex, 1))).toBeVisible();

      await page.getByTestId("next-month").click();
      const nextExpected = monthIndex === 11 ? `${MONTHS_DE[0]} ${year + 1}` : `${MONTHS_DE[monthIndex + 1]} ${year}`;
      await expect(page.getByTestId("month-label")).toHaveText(nextExpected);
    }

    // Eine Monatsrückwärts-Navigation prüfen.
    const before = await page.getByTestId("month-label").innerText();
    await page.getByTestId("prev-month").click();
    await expect(page.getByTestId("month-label")).not.toHaveText(before);

    // Über die Monate hinweg traten mehrere unterschiedliche Offsets auf.
    expect(seenOffsets.size).toBeGreaterThan(1);
  });
});
