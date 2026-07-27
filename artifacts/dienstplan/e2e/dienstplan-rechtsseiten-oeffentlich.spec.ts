import { test, expect } from "@playwright/test";

/**
 * Task #593 — Rechtsseiten bleiben auch OHNE Login erreichbar.
 *
 * Impressum und Datenschutzerklärung müssen rechtlich ohne Anmeldung abrufbar
 * sein. Die Routen stehen in PUBLIC_PATHS (App.tsx) — dieser Test schreibt das
 * fest, damit eine spätere Änderung am Auth-Redirect den öffentlichen Zugriff
 * nicht unbemerkt kaputt macht.
 *
 * Dev-Auto-Login-Falle: Im Vite-DEV-Stack meldet die App bei 401 automatisch
 * per POST /api/auth/dev-login an — dann wäre "ausgeloggt" nie beobachtbar.
 * Die ausgeloggten Tests fangen diesen Request ab und beantworten ihn mit 401,
 * sodass die App unauthentifiziert bleibt (Muster wie in
 * dienstplan-registrierung-doppelte-email.spec.ts).
 *
 * Zusätzlich: Die Fußzeilen-Links (eingeloggt) müssen echte Ziele haben
 * (kein href="#") und der In-App-Link Barrierefreiheit führt auf die Seite.
 */

async function blockDevAutoLogin(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/dev-login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Dev-Auto-Login im Test deaktiviert" }),
    }),
  );
}

test.describe("Rechtsseiten ohne Login", () => {
  const pages = [
    { path: "/impressum", heading: "Impressum" },
    { path: "/datenschutz", heading: "Datenschutzerklärung" },
    { path: "/kontakt", heading: "Kontakt" },
    { path: "/barrierefreiheit", heading: "Erklärung zur Barrierefreiheit" },
  ] as const;

  for (const { path, heading } of pages) {
    test(`ausgeloggt rendert ${path} ohne Redirect auf /login`, async ({ page }) => {
      await blockDevAutoLogin(page);
      await page.goto(path);

      // Die Seite rendert ihren Rechtstext …
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible({ timeout: 20_000 });

      // … samt öffentlichem Rückweg zur Anmeldung …
      await expect(
        page.getByRole("button", { name: "Zurück zur Anmeldung" }),
      ).toBeVisible();

      // … und die URL bleibt stehen (kein Auth-Redirect auf /login).
      expect(new URL(page.url()).pathname).toContain(path);
    });
  }

  test("ausgeloggt bleibt eine geschützte Seite weiterhin gesperrt (Gegenprobe)", async ({
    page,
  }) => {
    await blockDevAutoLogin(page);
    await page.goto("/dienstplan");
    // Der Auth-Redirect selbst funktioniert noch — sonst testet der Spec ins Leere.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
      .toContain("/login");
  });
});

test.describe("Fußzeilen-Links (eingeloggt)", () => {
  test("alle Links der Rechtliches-Fußzeile haben echte Ziele", async ({ page }) => {
    // Ohne Route-Block: Dev-Auto-Login meldet an, Layout samt Fußzeile rendert.
    await page.goto("/");
    // Mobile Standard-Viewport: die Nav-Links stecken im Menü — auf die
    // Dashboard-Überschrift warten (Auto-Dev-Login abgeschlossen, Layout da).
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
      timeout: 20_000,
    });

    const nav = page.getByRole("navigation", { name: "Rechtliches" });
    await expect(nav).toBeVisible();

    const links = nav.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(4); // Impressum, Datenschutz, Kontakt, Barrierefreiheit

    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute("href");
      expect(href, `Fußzeilen-Link ${i} braucht ein echtes Ziel`).toBeTruthy();
      expect(href).not.toBe("#");
      expect(href!.startsWith("https://") || href!.startsWith("/")).toBe(true);
    }

    // Der In-App-Link führt tatsächlich auf die Barrierefreiheits-Seite.
    await nav.getByRole("link", { name: "Barrierefreiheit" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Erklärung zur Barrierefreiheit" }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
