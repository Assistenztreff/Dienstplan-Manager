import { expect, type Locator, type Page } from "@playwright/test";

type ApiShift = { id: number; userId: number; startTime: string };

/**
 * Wählt eine Tageszelle im Monatsgitter aus (Zwei-Stufen-Klick-Modell).
 *
 * Hintergrund: Der erste Klick auf einen Tag markiert ihn nur (Tagesdetail
 * erscheint unter dem Kalender); erst ein ZWEITER Klick auf den bereits
 * markierten Tag öffnet als Admin den Schicht-Dialog. Dieser Helper stellt
 * die reine Auswahl sicher: Ist der Tag bereits markiert, wird NICHT erneut
 * geklickt (sonst würde der Dialog aufgehen). Öffnet sich dennoch ein Dialog
 * (defensive Absicherung), wird er per Escape geschlossen.
 */
export async function selectDayCell(page: Page, cell: Locator): Promise<void> {
  const already = (await cell.getAttribute("data-selected")) === "true";
  if (!already) {
    await cell.click();
  }
  const dialog = page.getByTestId("shift-dialog");
  const opened = await dialog
    .waitFor({ state: "visible", timeout: 750 })
    .then(() => true)
    .catch(() => false);
  if (opened) {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await expect(cell).toHaveAttribute("data-selected", "true");
}

/**
 * Wählt ein Datum im app-eigenen Kalender-Picker des Schicht-Dialogs.
 *
 * Das frühere native `<input type="date">` wurde durch einen Button
 * (`shift-dialog-date`, ISO-Wert im Attribut `data-value`) + zentriertes
 * Kalender-Overlay (`shift-dialog-date-picker`) ersetzt. Der Kalender nutzt
 * Monats-/Jahres-Dropdowns (native Selects), daher ist jede Zieldatums-Wahl
 * ohne Chevron-Klickerei deterministisch möglich.
 */
export async function pickShiftDialogDate(
  page: Page,
  dialog: Locator,
  isoDate: string,
): Promise<void> {
  const target = new Date(`${isoDate}T00:00:00`);
  const picker = page.getByTestId("shift-dialog-date-picker");
  // Kein Auto-Öffnen: Der Kalender darf erst nach dem Klick erscheinen.
  await expect(picker).toHaveCount(0);
  await dialog.getByTestId("shift-dialog-date").click();
  await expect(picker).toBeVisible();
  const dropdowns = picker.locator("select");
  // react-day-picker rendert (locale de): erst Monat (Werte 0-11), dann Jahr.
  await dropdowns.nth(0).selectOption(String(target.getMonth()));
  await dropdowns.nth(1).selectOption(String(target.getFullYear()));
  // Ohne Outside-Days ist die Tageszahl im Monat eindeutig.
  await picker
    .locator("button[data-day]")
    .filter({ hasText: new RegExp(`^${target.getDate()}$`) })
    .click();
  await expect(picker).toHaveCount(0);
  await expect(dialog.getByTestId("shift-dialog-date")).toHaveAttribute(
    "data-value",
    isoDate,
  );
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
