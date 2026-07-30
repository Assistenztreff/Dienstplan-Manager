import { test, expect } from "@playwright/test";

/**
 * UI-Test #653: Die Registrierungsseite muss bei HTTP 429 (Rate-Limit) eine
 * Wartezeit-Meldung mit der verbleibenden Zeit anzeigen — und NICHT mit einem
 * generischen Fehler oder gar einem Absturz reagieren.
 *
 * Hintergrund: Der Backend-Rate-Limiter (register-rate-limit.ts) gibt bei zu
 * vielen Registrierungsversuchen einer IP 429 + `Retry-After`-Header zurück.
 * Das Frontend (registrierung.tsx / auth.tsx) wertet `retryAfterSeconds` aus
 * und zeigt eine minutengenaue Wartezeit.
 *
 * Da der Rate-Limiter im E2E-Test-Stack absichtlich deaktiviert ist
 * (REGISTER_RATE_LIMIT_MAX=0), simuliert dieser Test den 429 mit page.route(),
 * um ausschließlich das Frontend-Rendering der Wartezeit-Meldung zu prüfen.
 * Der Unit-Test (register-rate-limit.db.test.ts) deckt die Backend-Logik ab.
 *
 * Geprüft:
 * - Die Registrierungsseite bleibt erreichbar (kein Auto-Dev-Login).
 * - Bei 429 mit retryAfterSeconds = 60 erscheint ein Text mit "Zu viele Versuche"
 *   und eine Zeitangabe ("1 Minute" o.Ä.).
 * - Die Seite navigiert NICHT weg (URL bleibt /registrierung).
 */
test("Registrierungsseite zeigt Wartezeit-Meldung bei 429 vom Server (#653)", async ({ page }) => {
  test.setTimeout(60_000);

  // Dev-Auto-Login deaktivieren (würde öffentliche Registrierungsseite verstecken).
  await page.route("**/api/auth/dev-login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "e2e-dev-login-blocked" }),
    }),
  );

  // POST /api/auth/register → 429 mit Rate-Limit-Body simulieren.
  await page.route("**/api/auth/register", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "60" },
      body: JSON.stringify({
        error: "Zu viele Registrierungsversuche — bitte später erneut versuchen.",
        code: "rate_limited",
        retryAfterSeconds: 60,
      }),
    });
  });

  await page.goto("/registrierung");
  await expect(
    page.getByRole("button", { name: "Registrieren" }),
    "Registrierungsseite muss unauthentifiziert erreichbar sein",
  ).toBeVisible({ timeout: 15_000 });

  // Formularfelder befüllen (name, email, password, password-repeat).
  await page.locator("#name").fill("Rate Limit E2E");
  await page.locator("#email").fill("ratelimit-e2e@e2e.test");
  await page.locator("#password").fill("test1234567");
  await page.locator("#password-repeat").fill("test1234567");

  await page.getByRole("button", { name: "Registrieren" }).click();

  // --- Wartezeit-Meldung muss erscheinen -----------------------------------
  // auth.tsx zeigt bei code="rate_limited" + retryAfterSeconds einen Text wie
  // "Zu viele Versuche — bitte in 1 Minute erneut versuchen."
  await expect(
    page.getByText(/zu viele versuche/i),
    "Registrierungsseite muss bei 429 'Zu viele Versuche' anzeigen",
  ).toBeVisible({ timeout: 10_000 });

  // Die Meldung soll die Wartezeit in Minuten nennen.
  await expect(
    page.getByText(/minute/i),
    "Die Wartezeit-Meldung muss die Zeitangabe in Minuten enthalten",
  ).toBeVisible();

  // Kein versehentliches Weiterleiten nach dem Fehler.
  await expect(page, "Bei Fehler darf nicht zur Dashboard-Seite navigiert werden").toHaveURL(
    /\/registrierung/,
  );
});
