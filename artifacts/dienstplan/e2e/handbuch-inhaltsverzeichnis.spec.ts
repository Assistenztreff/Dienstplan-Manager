import { test, expect } from "@playwright/test";

/**
 * UI-Test (Task #628): Das Inhaltsverzeichnis des Handbuchs ist sichtbar
 * und benutzbar:
 *
 * 1. Startseite (/handbuch): vollständige Kapitel-Übersicht (Erste Schritte,
 *    Modul-Übersicht, Verwaltung) mit Badges; die Kapitel (Dienstplan,
 *    Team-Verwaltung, …) sind direkt anklickbar.
 * 2. Artikel-Seiten unterhalb der Desktop-Breite: die Kapitelliste ist über
 *    einen ausklappbaren Drawer (von links) erreichbar — die Desktop-Seitenleiste
 *    ist dort ausgeblendet — und ihre Links funktionieren.
 *
 * Das Handbuch ist öffentlich (kein Login nötig); der Dev-Auto-Login wird
 * wie in dienstplan-auth-tastatur.spec.ts mit 401 beantwortet, damit der
 * Test unabhängig vom Seed-Admin läuft.
 */

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/dev-login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Dev-Auto-Login im Test deaktiviert" }),
    }),
  );
});

test("Startseite zeigt das vollständige Inhaltsverzeichnis, Kapitel-Links funktionieren", async ({
  page,
}) => {
  await page.goto("/handbuch");

  const toc = page.getByTestId("handbuch-inhaltsverzeichnis");
  await expect(toc).toBeVisible();

  // Alle drei Kapitel-Gruppen sind da.
  for (const gruppe of ["Erste Schritte", "Modul-Übersicht", "Verwaltung"]) {
    await expect(toc.getByRole("heading", { name: gruppe })).toBeVisible();
  }

  // Badges wie in der Seitenleiste.
  await expect(toc.getByText("Premium").first()).toBeVisible();
  // "Nur Dienstleister" ist in der Kapitelliste ein Icon mit
  // Screenreader-Text (sr-only) — daher toBeAttached statt toBeVisible.
  await expect(toc.getByText("Nur Dienstleister")).toBeAttached();

  // Das Einstellungen-Kapitel existiert inzwischen samt Unterabschnitten —
  // seine Unterpunkte springen als Anker-Links in die Kapitelseite.
  await expect(toc.getByRole("link", { name: "Schichtmodelle" })).toHaveCount(1);
  await expect(toc.getByRole("link", { name: "Kalender-Abo" })).toHaveCount(1);

  // Die Modul-Kapitel sind verlinkt. Das frühere Kapitel "Assistenten" heißt
  // seit der Vereinheitlichung der Teamverwaltung "Assistenzkräfte".
  for (const kapitel of ["Dashboard", "Assistenzkräfte", "Zeiterfassung", "Abwesenheiten"]) {
    await expect(toc.getByRole("link", { name: kapitel, exact: true })).toHaveCount(1);
  }
  await expect(
    toc.getByRole("link", { name: "Auswertungen", exact: true }),
  ).toHaveCount(1);

  // Vorhandene Kapitel sind direkt anklickbar.
  await toc.getByRole("link", { name: "Team-Verwaltung" }).click();
  await expect(page).toHaveURL(/\/handbuch\/team-verwaltung$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Team-Verwaltung" }),
  ).toBeVisible();

  await page.goBack();
  await toc.getByRole("link", { name: "Dienstplan" }).click();
  await expect(page).toHaveURL(/\/handbuch\/dienstplan$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dienstplan" })).toBeVisible();
});

test("Artikel-Seite: Kapitelliste ist im Mobil-Viewport per Drawer erreichbar und verlinkt", async ({
  page,
}) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto("/handbuch/dienstplan");

  // Desktop-Seitenleiste ist unterhalb lg ausgeblendet …
  await expect(page.locator("aside nav[aria-label='Handbuch-Kapitel']")).toBeHidden();

  // … stattdessen gibt es den Drawer-Button.
  const btn = page.getByTestId("handbuch-kapitel-mobil");
  await expect(btn).toBeVisible();

  // Drawer noch geschlossen: nicht im DOM.
  await expect(page.getByTestId("handbuch-drawer")).toHaveCount(0);

  // Drawer öffnen.
  await btn.getByText("Kapitel-Übersicht").click();

  const drawer = page.getByTestId("handbuch-drawer");
  await expect(drawer).toBeVisible();

  // Kapitel-Links im Drawer sichtbar und funktionsfähig.
  const teamLink = drawer.getByRole("link", { name: "Team-Verwaltung" });
  await expect(teamLink).toBeVisible();
  await expect(drawer.getByText("Nur Dienstleister")).toBeAttached();

  await teamLink.click();
  await expect(page).toHaveURL(/\/handbuch\/team-verwaltung$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Team-Verwaltung" }),
  ).toBeVisible();
});

test("Artikel-Seite: Desktop-Seitenleiste bleibt im Desktop-Viewport unverändert sichtbar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/handbuch/dienstplan");

  await expect(page.locator("aside nav[aria-label='Handbuch-Kapitel']")).toBeVisible();
  // Der mobile Drawer-Button ist ab lg ausgeblendet.
  await expect(page.getByTestId("handbuch-kapitel-mobil")).toBeHidden();
});
