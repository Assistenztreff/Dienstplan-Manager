import { test, expect } from "@playwright/test";

/**
 * UI-Test (Task #611): Die neuen AssistenzTreff-Auth-Bausteine bleiben per
 * Tastatur bedienbar und sichtbar fokussierbar:
 *
 * 1. Auge-Toggle am Passwortfeld: schaltet per Tastatur (Enter/Space) das
 *    Feld zwischen type=password und type=text um.
 * 2. Konto-Typ-Segmentleiste (Privat/Gewerblich): per Tastatur erreichbar
 *    und wählbar (aria-checked wechselt).
 * 3. Client-Prüfung "Passwörter stimmen nicht überein" erscheint, wenn
 *    Passwort und Wiederholung abweichen — OHNE Server-Roundtrip/Navigation.
 *
 * Rein clientseitig — es wird KEIN Konto angelegt (der Mismatch-Fall bricht
 * vor dem Request ab), daher kein Fixture-/Cleanup-Bedarf.
 *
 * Dev-Auto-Login-Falle: Im Vite-DEV-Stack meldet die App bei 401 automatisch
 * per POST /api/auth/dev-login als Seed-Admin an — dann wäre die öffentliche
 * Registrierungsseite nie sichtbar. Der Test fängt diesen Request ab und
 * beantwortet ihn mit 401 (Muster wie dienstplan-registrierung-doppelte-email).
 */

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/dev-login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Dev-Auto-Login im Test deaktiviert" }),
    }),
  );
  await page.goto("/registrierung");
  await expect(
    page.getByRole("button", { name: "Registrieren" }),
    "Die Registrierungsseite muss unauthentifiziert erreichbar sein",
  ).toBeVisible();
});

test("Auge-Toggle schaltet das Passwortfeld per Tastatur sichtbar/unsichtbar", async ({
  page,
}) => {
  const password = page.locator("#password");
  await password.fill("geheimespasswort");
  await expect(password).toHaveAttribute("type", "password");

  // Der Toggle liegt direkt hinter dem Feld in der Tab-Reihenfolge.
  await password.press("Tab");
  const toggle = page.getByRole("button", { name: "Passwort anzeigen" }).first();
  await expect(toggle, "Tab vom Passwortfeld muss den Auge-Toggle fokussieren").toBeFocused();

  // Sichtbarer Fokus: der Toggle zeigt eine Outline im Fokuszustand.
  const outlineStyle = await toggle.evaluate(
    (el) => getComputedStyle(el).outlineStyle,
  );
  expect(outlineStyle, "Fokussierter Auge-Toggle braucht sichtbare Outline").not.toBe(
    "none",
  );

  // Enter aktiviert den Toggle -> Passwort im Klartext.
  await toggle.press("Enter");
  await expect(password).toHaveAttribute("type", "text");
  await expect(
    page.getByRole("button", { name: "Passwort verbergen" }).first(),
  ).toBeFocused();

  // Space schaltet wieder zurück auf verborgen.
  await page.keyboard.press("Space");
  await expect(password).toHaveAttribute("type", "password");
  // Der Feldinhalt bleibt beim Umschalten erhalten.
  await expect(password).toHaveValue("geheimespasswort");
});

test("Konto-Typ-Segmentleiste ist per Tastatur wählbar", async ({ page }) => {
  const privat = page.getByTestId("registrierung-typ-privat");
  const gewerblich = page.getByTestId("registrierung-typ-dienstleister");

  // Ausgangszustand: Privat ist vorausgewählt.
  await expect(privat).toHaveAttribute("aria-checked", "true");
  await expect(gewerblich).toHaveAttribute("aria-checked", "false");

  // Per Tastatur zum Gewerblich-Knopf und mit Enter auswählen.
  await gewerblich.focus();
  await expect(gewerblich).toBeFocused();
  const outlineStyle = await gewerblich.evaluate(
    (el) => getComputedStyle(el).outlineStyle,
  );
  expect(
    outlineStyle,
    "Fokussierter Konto-Typ-Knopf braucht sichtbare Outline",
  ).not.toBe("none");

  await gewerblich.press("Enter");
  await expect(gewerblich).toHaveAttribute("aria-checked", "true");
  await expect(privat).toHaveAttribute("aria-checked", "false");
  // Der Hinweistext wechselt zum Dienstleister-Hinweis.
  await expect(page.getByText(/Assistenzdienst \(Dienstleister\)/)).toBeVisible();

  // Und per Space wieder zurück auf Privat.
  await privat.focus();
  await privat.press("Space");
  await expect(privat).toHaveAttribute("aria-checked", "true");
  await expect(gewerblich).toHaveAttribute("aria-checked", "false");
});

test("Abweichende Passwort-Wiederholung zeigt die Client-Fehlermeldung", async ({
  page,
}) => {
  await page.locator("#name").fill("E2E Tastatur Auth");
  await page.locator("#email").fill("e2e.tastatur-auth@dienstplan.test");
  await page.locator("#password").fill("passwort12345678");
  await page.locator("#password-repeat").fill("anderespasswort99");

  // Per Tastatur abschicken (Enter im Formularfeld).
  await page.locator("#password-repeat").press("Enter");

  await expect(
    page.getByText("Passwörter stimmen nicht überein"),
    "Die Client-Prüfung muss den Passwort-Mismatch melden",
  ).toBeVisible();
  // Keine Navigation weg von der Registrierung.
  await expect(page).toHaveURL(/\/registrierung$/);
});
