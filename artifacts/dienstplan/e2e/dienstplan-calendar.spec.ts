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

    // Zurück zur Monatsansicht: Gitter und Tagesdetail sichtbar.
    await page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-grid").click();
    await expect(page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-grid")).toHaveAttribute("data-active", "true");
    await expect(mobile.getByTestId("month-grid")).toBeVisible();
    await expect(mobile.getByTestId("day-detail-header")).toBeVisible();
  });

  test("Assistenten-Filter wählt aus und setzt zurück", async ({ page }) => {
    const mobile = await openCalendar(page);

    const filter = page.getByTestId("assistant-filter");
    await expect(filter).toBeVisible();
    await expect(filter.getByTestId("assistant-chip-all")).toHaveAttribute("data-active", "true");

    // Ersten konkreten Assistenten-Chip auswählen.
    const assistantChip = filter
      .locator('button:not([data-testid="assistant-chip-all"])')
      .first();
    await expect(assistantChip).toBeVisible();
    await assistantChip.click();
    await expect(assistantChip).toHaveAttribute("data-active", "true");
    await expect(filter.getByTestId("assistant-chip-all")).toHaveAttribute("data-active", "false");

    // Auf "Alle" zurücksetzen.
    await filter.getByTestId("assistant-chip-all").click();
    await expect(filter.getByTestId("assistant-chip-all")).toHaveAttribute("data-active", "true");
    await expect(assistantChip).toHaveAttribute("data-active", "false");
  });

  test("Tagesauswahl im Monatsgitter aktualisiert das Tagesdetail", async ({ page }) => {
    const mobile = await openCalendar(page);
    const { year, monthIndex } = parseMonthLabel(
      await page.getByTestId("month-label").innerText(),
    );

    const cell15 = mobile.getByTestId(dayCellId(year, monthIndex, 15));
    await selectDayCell(page, cell15);
    await expect(cell15).toHaveAttribute("data-selected", "true");
    await expect(mobile.getByTestId("day-detail-header")).toContainText("15.");

    const cell20 = mobile.getByTestId(dayCellId(year, monthIndex, 20));
    await selectDayCell(page, cell20);
    await expect(cell20).toHaveAttribute("data-selected", "true");
    await expect(cell15).toHaveAttribute("data-selected", "false");
    await expect(mobile.getByTestId("day-detail-header")).toContainText("20.");
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
