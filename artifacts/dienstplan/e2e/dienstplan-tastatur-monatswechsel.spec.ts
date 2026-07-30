/**
 * #511 – Tastatur-Monatswechsel auch im Agenda- und Tabellen-Modus.
 *
 * MonthGrid (Kachel-Ansicht) hat bereits Tastatur-Navigation (ArrowLeft/Right
 * an den Monatsgrenzen). Dieser Spec sichert, dass Agenda-Modus (mobil) und
 * Tabellen-Modus (Desktop) ebenfalls per ArrowLeft/ArrowRight oder
 * PageUp/PageDown monatlich navigierbar sind, wenn der View-Container fokussiert
 * ist.
 *
 * Technik:
 * - Agenda-Ansicht: data-testid="agenda-view", tabIndex=0, onKeyDown für
 *   ArrowLeft/PageUp → prevMonth, ArrowRight/PageDown → nextMonth.
 * - Tabellen-Ansicht: Die Card hat tabIndex=0 und denselben onKeyDown.
 *
 * Der aktuelle Monatsname wird aus dem Sticky-Header (`h2[aria-label]` oder
 * dem h2 mit "Dienstplan") herausgelesen und nach dem Monatswechsel geprüft.
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers/teams";
import { format, addMonths, subMonths } from "date-fns";
import { de } from "date-fns/locale";

const TODAY = new Date();

/** Monatsname so wie ihn der Sticky-Header zeigt (z. B. "Juli 2026"). */
function monthLabel(date: Date): string {
  return format(date, "MMMM yyyy", { locale: de });
}

async function loginAndGoToDienstplan(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Login (${res.status()})`).toBe(true);
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan" })).toBeVisible({ timeout: 15_000 });
}

// ---- Agenda-Modus (mobile, 402 px) -----------------------------------------

test.describe("Tastatur-Monatswechsel im Agenda-Modus (mobil)", () => {
  test.use({ viewport: { width: 402, height: 874 } });

  test("ArrowRight wechselt zum nächsten Monat (#511)", async ({ page }) => {
    test.setTimeout(40_000);
    await loginAndGoToDienstplan(page);

    // In Listenansicht (Agenda) wechseln.
    await page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list").click();
    const agendaView = page.getByTestId("agenda-view");
    await expect(agendaView).toBeVisible({ timeout: 5_000 });

    // Aktuellen Monatsheader ablesen.
    const expectedNext = monthLabel(addMonths(TODAY, 1));

    // AgendaView fokussieren und ArrowRight drücken.
    await agendaView.focus();
    await page.keyboard.press("ArrowRight");

    // Monatsheader muss auf nächsten Monat zeigen.
    const header = page.locator("h2").filter({ hasText: "Dienstplan" });
    await expect(header).toContainText(expectedNext, { timeout: 5_000 });
  });

  test("ArrowLeft wechselt zum vorherigen Monat (#511)", async ({ page }) => {
    test.setTimeout(40_000);
    await loginAndGoToDienstplan(page);

    await page.getByTestId("view-toggles-mobile").getByTestId("view-toggle-list").click();
    const agendaView = page.getByTestId("agenda-view");
    await expect(agendaView).toBeVisible({ timeout: 5_000 });

    const expectedPrev = monthLabel(subMonths(TODAY, 1));

    await agendaView.focus();
    await page.keyboard.press("ArrowLeft");

    const header = page.locator("h2").filter({ hasText: "Dienstplan" });
    await expect(header).toContainText(expectedPrev, { timeout: 5_000 });
  });
});

// ---- Tabellen-Modus (desktop, 1280 px) -------------------------------------

test.describe("Tastatur-Monatswechsel im Tabellen-Modus (Desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("ArrowRight wechselt zum nächsten Monat (#511)", async ({ page }) => {
    test.setTimeout(40_000);
    await loginAndGoToDienstplan(page);

    // In Tabellenansicht wechseln.
    await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-table").click();
    // Tabellen-Card: tabIndex=0, role=generic.
    // Wir fokussieren über Tab-Taste oder via JavaScript.
    const tableCard = page.getByTestId("dienstplan-desktop").locator('[tabindex="0"]').first();
    await tableCard.focus();

    const expectedNext = monthLabel(addMonths(TODAY, 1));
    await page.keyboard.press("ArrowRight");

    const header = page.locator("h2").filter({ hasText: "Dienstplan" });
    await expect(header).toContainText(expectedNext, { timeout: 5_000 });
  });

  test("ArrowLeft wechselt zum vorherigen Monat (#511)", async ({ page }) => {
    test.setTimeout(40_000);
    await loginAndGoToDienstplan(page);

    await page.getByTestId("view-toggles-desktop").getByTestId("view-toggle-table").click();
    const tableCard = page.getByTestId("dienstplan-desktop").locator('[tabindex="0"]').first();
    await tableCard.focus();

    const expectedPrev = monthLabel(subMonths(TODAY, 1));
    await page.keyboard.press("ArrowLeft");

    const header = page.locator("h2").filter({ hasText: "Dienstplan" });
    await expect(header).toContainText(expectedPrev, { timeout: 5_000 });
  });
});
