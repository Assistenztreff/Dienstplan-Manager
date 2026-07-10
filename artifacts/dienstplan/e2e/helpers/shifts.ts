import { expect, type Locator, type Page } from "@playwright/test";

type ApiShift = { id: number; userId: number; startTime: string };

/**
 * Wählt eine Tageszelle im Monatsgitter aus, ohne den seit dem UI-Refresh
 * automatisch geöffneten Schicht-Dialog offen zu lassen.
 *
 * Hintergrund: Für Admins öffnet ein Klick auf eine Monatszelle jetzt
 * zusätzlich zur Tagesauswahl direkt den Schicht-Dialog mit vorbelegtem
 * Datum. Specs, die nur den Tag auswählen wollen (um z. B. das Tagesdetail
 * zu prüfen oder anschließend gezielt "+ Schicht" zu klicken), schließen den
 * Dialog hier wieder per Escape. Bei Rollen ohne Bearbeitungsrecht oder im
 * Auswahlmodus öffnet sich kein Dialog — dann ist das Schließen ein No-Op.
 */
export async function selectDayCell(page: Page, cell: Locator): Promise<void> {
  await cell.click();
  const dialog = page.getByTestId("shift-dialog");
  const opened = await dialog
    .waitFor({ state: "visible", timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (opened) {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
}

/**
 * Entfernt alle Schichten des Nutzers, die an den Tagen day-1..day+1 des
 * angegebenen Monats beginnen (deckt auch Übernacht-/24h-Dienste ab).
 *
 * Hintergrund: Seit der Free/Premium-Einführung ist die Vorausplanung auch für
 * Premium auf 12 Monate begrenzt — die Specs können Kollisionen also nicht mehr
 * durch "weit in die Zukunft navigieren" vermeiden. Stattdessen räumt jeder
 * Spec seinen Zieltag vor dem Anlegen frei, damit Leftover-Schichten aus
 * früheren (ggf. abgebrochenen) Läufen keine Überschneidungs-Warnung auslösen.
 */
export async function clearUserShiftsAroundDay(
  page: Page,
  year: number,
  month: number,
  day: number,
  userId: number,
): Promise<void> {
  const res = await page.request.get(`/api/shifts?month=${month}&year=${year}`);
  expect(res.ok(), "GET /api/shifts (Pre-Clean) fehlgeschlagen").toBe(true);
  const shifts = (await res.json()) as ApiShift[];
  for (const s of shifts) {
    if (s.userId !== userId) continue;
    const start = new Date(s.startTime);
    if (start.getFullYear() !== year || start.getMonth() + 1 !== month) continue;
    if (Math.abs(start.getDate() - day) <= 1) {
      const del = await page.request.delete(`/api/shifts/${s.id}`);
      expect(del.ok(), `Pre-Clean der Schicht ${s.id} fehlgeschlagen`).toBe(true);
    }
  }
}
