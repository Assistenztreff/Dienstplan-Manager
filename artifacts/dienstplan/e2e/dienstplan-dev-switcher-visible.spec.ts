import { test, expect } from "@playwright/test";

/**
 * Task #281 — Der Test-Nutzer-Wechsler ist im Dev-Modus wieder sichtbar.
 *
 * Gegenstück zum Prod-Spec `dienstplan-prod-dev-switcher-hidden.spec.ts`:
 * Der isolierte E2E-Stack läuft im Vite-DEV-Modus (Auto-Dev-Login aktiv),
 * dort MUSS der Umschalter in der Desktop-Sub-Navigation erscheinen —
 * sonst ist das Dev-Werkzeug wieder still verschwunden (Regression aus dem
 * Header-Redesign).
 */

test.describe("Dev-Modus: Test-Nutzer-Wechsler sichtbar", () => {
  // Der Umschalter ist nur ab md sichtbar — Desktop-Viewport nötig.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Umschalter erscheint in der Sub-Navigation und listet Test-Nutzer", async ({ page }) => {
    await page.goto("/");

    // Auto-Dev-Login: App-Shell mit Navigation erscheint ohne Formular.
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });

    // Der Dev-Umschalter ist gemountet und sichtbar.
    const trigger = page.locator('[aria-label="Test-Nutzer wechseln"]');
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    // Er öffnet sich und bietet mindestens einen Test-Nutzer an.
    await trigger.click();
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10_000 });
  });
});
