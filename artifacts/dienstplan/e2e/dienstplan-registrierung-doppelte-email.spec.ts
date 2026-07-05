import { test, expect } from "@playwright/test";
import {
  deleteFreeAccount,
  registerFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Test (Task #384): Der ÖFFENTLICHE Registrierungs-Pfad
 * (`/registrierung` → POST /api/auth/register) muss eine bereits vergebene
 * E-Mail freundlich behandeln — genau wie der Anlege-/Bearbeiten-Pfad für
 * Assistenten (Task #372): Server antwortet mit 409 und klarer Meldung, und die
 * Registrierungsseite zeigt sie DIREKT AM E-MAIL-FELD an (nicht nur als
 * generischer Sammel-Fehler).
 *
 * Aufbau:
 * - Ein Free-Konto wird per API registriert; seine E-Mail ist damit belegt.
 * - Eine frische Browser-Sitzung (ohne Cookies) ruft /registrierung auf und
 *   versucht sich mit DERSELBEN E-Mail zu registrieren.
 *
 * Dev-Auto-Login-Falle: Im Vite-DEV-Stack meldet die App bei 401 automatisch
 * per POST /api/auth/dev-login als Seed-Admin an — dann wäre die öffentliche
 * Registrierungsseite nie sichtbar. Der Test fängt diesen einen Request ab und
 * beantwortet ihn mit 401, sodass die App unauthentifiziert bleibt und die
 * echte Registrierungsseite rendert.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

let existing: FreeAccount;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // Belegt eine E-Mail (Muster e2e.*@dienstplan.test) über den echten
  // Registrierungs-Endpunkt.
  existing = await registerFreeAccount("privat", "reg-dup-email");
});

test.afterAll(async () => {
  await deleteFreeAccount(existing);
});

test("Registrierung mit bereits vergebener E-Mail zeigt den Fehler am E-Mail-Feld", async ({
  page,
}) => {
  test.setTimeout(90_000);

  // Dev-Auto-Login unterbinden, damit die öffentliche Registrierungsseite
  // erreichbar bleibt (siehe Kopfkommentar).
  await page.route("**/api/auth/dev-login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Dev-Auto-Login im Test deaktiviert" }),
    }),
  );

  await page.goto("/registrierung");

  // Die öffentliche Registrierungsseite muss sichtbar sein.
  await expect(
    page.getByRole("button", { name: "Registrieren" }),
    "Die Registrierungsseite muss unauthentifiziert erreichbar sein",
  ).toBeVisible();

  await page.locator("#name").fill("E2E Doppelte Email");
  await page.locator("#email").fill(existing.email);
  await page.locator("#password").fill("neuespasswort123");

  await page.getByRole("button", { name: "Registrieren" }).click();

  // Der Fehler erscheint DIREKT am E-Mail-Feld (nicht als generischer Fehler).
  const emailError = page.getByTestId("registrierung-email-error");
  await expect(
    emailError,
    "Die doppelte E-Mail muss am E-Mail-Feld gemeldet werden",
  ).toBeVisible();
  await expect(emailError).toContainText(/bereits verwendet/i);

  // Es darf KEINE Navigation weg von der Registrierung erfolgt sein.
  await expect(page, "Bei Fehler darf nicht weitergeleitet werden").toHaveURL(
    /\/registrierung$/,
  );
});
