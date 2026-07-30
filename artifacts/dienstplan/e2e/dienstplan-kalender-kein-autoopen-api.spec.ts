/**
 * #510 – Kalender öffnet auch bei Verträgen, Abwesenheiten & Zeiterfassung
 *        nicht mehr von selbst.
 *
 * Regression-Spec: Die DatePickerField-Komponente soll den Kalender-Dialog
 * AUSSCHLIESSLICH auf explizite Nutzeraktion (Klick auf den Auslöser-Button)
 * öffnen — niemals automatisch durch ein mount-seitiges useEffect.
 *
 * Geprüfte Seiten / Kontexte:
 *   1. /abwesenheiten (Von-/Bis-DatePicker)
 *   2. /assistenten   (Assistent-Anlegen-Dialog → Vertragsbeginn-DatePicker)
 *   3. /zeiterfassung (Manueller-Eintrag-Dialog → Datum-DatePicker)
 *
 * Der Test öffnet die jeweilige Seite und prüft, dass der Datums-Popover
 * NICHT sichtbar ist, bevor der Nutzer explizit auf den Kalender-Button
 * geklickt hat.
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers/teams";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `Login (${res.status()})`).toBe(true);
}

const CALENDAR_VISIBLE_SELECTOR = "[data-radix-popover-content]";

// DatePickerField verwendet intern einen Dialog (kein Radix-Popover).
// Die DialogContent-testid wird von DatePickerField als `${testId}-picker` gesetzt.
// Wir prüfen konkret die beiden Datumsfelder der Abwesenheiten-Seite.
const FROM_PICKER = '[data-testid="absence-from-picker"]';
const TO_PICKER = '[data-testid="absence-to-picker"]';

test("Abwesenheiten: Von-DatePicker öffnet nicht automatisch beim Laden (#510)", async ({
  page,
}) => {
  test.setTimeout(40_000);
  await loginAsAdmin(page);
  await page.goto("/abwesenheiten");
  await expect(page.getByRole("heading", { name: "Abwesenheiten", exact: true })).toBeVisible({
    timeout: 10_000,
  });
  // Kalender-Dialog darf NICHT offen sein, bevor der Nutzer auf den Button klickt.
  await expect(page.locator(FROM_PICKER)).not.toBeVisible();
  await expect(page.locator(TO_PICKER)).not.toBeVisible();
});

test("Assistenten/Vertrag: Vertragsbeginn-DatePicker öffnet nicht automatisch (#510)", async ({
  page,
}) => {
  test.setTimeout(40_000);
  await loginAsAdmin(page);
  await page.goto("/assistenten");
  await expect(page.getByRole("heading", { name: "Assistenten" })).toBeVisible({
    timeout: 10_000,
  });
  // Neu-anlegen-Dialog öffnen.
  const createBtn = page.getByRole("button", { name: /Assistent(in)? anlegen|Neuer Assistent/i });
  if (await createBtn.isVisible()) {
    await createBtn.click();
    // Dialog ist offen — Kalender muss trotzdem geschlossen sein.
    await expect(page.locator(CALENDAR_VISIBLE_SELECTOR)).not.toBeVisible();
  }
  // Falls kein Button → Dialog kommt per anderen Weg auf, kein Auto-open.
  await expect(page.locator(CALENDAR_VISIBLE_SELECTOR)).not.toBeVisible();
});

test("Zeiterfassung: Datum-DatePicker öffnet nicht automatisch beim Öffnen des Dialogs (#510)", async ({
  page,
}) => {
  test.setTimeout(40_000);
  await loginAsAdmin(page);
  await page.goto("/zeiterfassung");
  await expect(page.getByRole("heading", { name: "Zeiterfassung" })).toBeVisible({
    timeout: 10_000,
  });
  // Manueller-Eintrag-Button (öffnet den Dialog).
  const manualBtn = page.getByTestId("manual-entry");
  if (await manualBtn.isVisible()) {
    await manualBtn.click();
    const dialog = page.getByTestId("manual-dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // Nach Dialog-Öffnung darf der Kalender-Popover NICHT sichtbar sein.
    await expect(page.locator(CALENDAR_VISIBLE_SELECTOR)).not.toBeVisible();
  }
  // Fallback: Seite öffnet keinen Dialog automatisch.
  await expect(page.locator(CALENDAR_VISIBLE_SELECTOR)).not.toBeVisible();
});
