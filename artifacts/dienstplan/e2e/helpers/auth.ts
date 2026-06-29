import { expect, type Page } from "@playwright/test";

/**
 * Tolerante UI-Anmeldung für die E2E-Tests.
 *
 * Im Dev-Modus meldet die App via /api/auth/dev-login automatisch als Admin an
 * und leitet von /login direkt auf / um – dann erscheint kein Login-Formular
 * (siehe `src/context/auth.tsx`). Ist die Auto-Anmeldung nicht aktiv (z.B. im
 * Prod-Build oder gegen einen isolierten Test-Stack), wird das Formular regulär
 * ausgefüllt. So bleibt derselbe Helper in beiden Umgebungen grün.
 */
export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  const emailField = page.locator("#email");
  try {
    await emailField.waitFor({ state: "visible", timeout: 5000 });
    await emailField.fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Anmelden" }).click();
  } catch {
    // Formular nicht sichtbar -> Auto-Anmeldung greift bereits.
  }
  await expect(page).toHaveURL(/\/$/);
}
