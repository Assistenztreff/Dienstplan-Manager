import { expect, type Page } from "@playwright/test";

/**
 * Helfer für die Dienstplan-Kopfzeile nach der Neustrukturierung (Task #856):
 * PDF-Export, Mehrfachauswahl-Einstieg und Abwesenheitskalender liegen im
 * Überlauf-Menü hinter dem "Weitere Aktionen"-Trigger (`header-overflow`).
 * Die bisherigen Testids (`simple-month-export`, `toggle-selection-mode`,
 * `open-abwesenheits-kalender`) leben unverändert auf den Menü-Einträgen —
 * sie sind aber erst nach dem Öffnen des Menüs im DOM.
 */

/** Öffnet das Überlauf-Menü ("Weitere Aktionen") in der Dienstplan-Kopfzeile. */
export async function openHeaderOverflow(page: Page): Promise<void> {
  await page.getByTestId("header-overflow").click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/**
 * Aktiviert die Mehrfachauswahl über das Überlauf-Menü.
 * Nach dem Klick schließt sich das Menü; in der Hauptleiste erscheint der
 * "Auswahl beenden"-Button (weiterhin `data-testid="toggle-selection-mode"`).
 */
export async function startSelectionMode(page: Page): Promise<void> {
  await openHeaderOverflow(page);
  await page.getByTestId("toggle-selection-mode").click();
  await expect(
    page.getByRole("button", { name: "Auswahl beenden" }),
  ).toBeVisible();
}

/**
 * Öffnet den Abwesenheitskalender (Jahresübersicht) über das Überlauf-Menü.
 */
export async function openAbwesenheitsKalender(page: Page): Promise<void> {
  await openHeaderOverflow(page);
  await page.getByTestId("open-abwesenheits-kalender").click();
  await expect(
    page.getByTestId("abwesenheits-kalender-popup"),
  ).toBeVisible();
}
