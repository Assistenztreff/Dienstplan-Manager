import { expect, type Page } from "@playwright/test";

/**
 * Wählt ein Datum in einem app-eigenen DatePickerField.
 *
 * Die früheren nativen `<input type="date">`-Felder wurden durch einen Button
 * (`data-testid`, ISO-Wert im Attribut `data-value`) + zentriertes
 * Kalender-Overlay (`<testid>-picker`) ersetzt (kein Auto-Öffnen auf iOS).
 * Der Kalender nutzt Monats-/Jahres-Dropdowns (native Selects), daher ist
 * jede Zieldatums-Wahl ohne Chevron-Klickerei deterministisch möglich.
 * (Verallgemeinerung von `pickShiftDialogDate` aus helpers/shifts.ts.)
 */
export async function pickDateField(
  page: Page,
  testId: string,
  isoDate: string,
): Promise<void> {
  const target = new Date(`${isoDate}T00:00:00`);
  const button = page.getByTestId(testId);
  const picker = page.getByTestId(`${testId}-picker`);
  await expect(picker).toHaveCount(0);
  await button.click();
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
  await expect(button).toHaveAttribute("data-value", isoDate);
}
