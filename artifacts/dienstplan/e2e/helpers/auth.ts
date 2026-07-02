import { expect, type Page } from "@playwright/test";

/**
 * Programmatische Anmeldung für die E2E-Tests (dev- UND prod-tauglich).
 *
 * Statt das Login-Formular auszufüllen, wird die Session direkt über die API
 * aufgebaut: `page.request` teilt den Cookie-Jar mit dem Browser, dadurch ist
 * `/api/auth/me` beim ersten Laden sofort 200 — der Vite-Dev-Auto-Login (der
 * sonst bei 401 automatisch als Seed-Admin anmeldet und von /login wegleitet)
 * greift damit nie. So agiert der Test garantiert als der GEWÜNSCHTE Nutzer
 * (wichtig für Assistenten-Logins), im Dev-Stack wie im Prod-Build.
 */
export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  const res = await page.request.post("/api/auth/login", {
    data: { email, password },
  });
  expect(res.ok(), `Login als ${email} fehlgeschlagen (${res.status()})`).toBe(true);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}
