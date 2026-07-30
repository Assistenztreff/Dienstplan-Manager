/**
 * #617 – Bestätigen, dass auch Login, Passwort-vergessen und Einladung
 *        per Tastatur bedienbar bleiben.
 */
import { test, expect, type Page } from "@playwright/test";

async function blockAuth(page: Page): Promise<void> {
  await page.route("**/api/auth/dev-login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "blocked for keyboard test" }),
    }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "unauthenticated" }),
    }),
  );
}

test("Registrierungs-Formular ist per Tastatur vollständig ausfüllbar (#617)", async ({
  page,
}) => {
  test.setTimeout(30_000);
  await blockAuth(page);
  await page.goto("/registrierung");

  await expect(page.locator("#name")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.locator("#password-repeat")).toBeVisible();

  // Tab-Reihenfolge: name → email → password → password-repeat.
  await page.locator("#name").focus();
  await expect(page.locator("#name")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.locator("#email")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.locator("#password")).toBeFocused();

  // Nach #password gibt es evtl. einen Sichtbarkeits-Toggle; bis zu 2× Tab.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("Tab");
    const onRepeat = await page
      .evaluate(() => document.activeElement?.id === "password-repeat")
      .catch(() => false);
    if (onRepeat) break;
  }
  await expect(page.locator("#password-repeat")).toBeFocused();

  await page.locator("#name").fill("E2E Keyboard User");
  await page.locator("#email").fill(`e2e.keyboard.${Date.now()}@dienstplan.test`);
  await page.locator("#password").fill("Testpasswort123!");
  await page.locator("#password-repeat").fill("Testpasswort123!");
  await page.keyboard.press("Enter");

  await page.waitForURL(/(registrierung|dienstplan|login)/, { timeout: 10_000 });
});

test("Passwort-vergessen-Seite ist per Tastatur navigierbar (#617)", async ({
  page,
}) => {
  test.setTimeout(20_000);
  await blockAuth(page);
  await page.goto("/passwort-vergessen?email=test%40example.com");

  await expect(
    page.locator('[data-testid="passwort-vergessen-email"]'),
  ).toBeVisible({ timeout: 8_000 });

  const backBtn = page.getByRole("button", { name: /Zurück zum Login/i });
  await expect(backBtn).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(backBtn).toBeFocused();

  await page.keyboard.press("Enter");
  await page.waitForURL(/\/login/, { timeout: 5_000 });
});

test("Einladungs-Seite stürzt bei ungültigem Token nicht ab (#617)", async ({
  page,
}) => {
  test.setTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await blockAuth(page);
  await page.goto("/einladung?token=ungueltig-e2e-keyboard-test");
  await page.waitForTimeout(2_500);

  const realErrors = errors.filter(
    (e) => !e.includes("401") && !e.includes("unauthenticated"),
  );
  expect(realErrors, `Unerwartete JS-Fehler: ${realErrors.join(", ")}`).toHaveLength(0);
});
