import { test, expect } from "@playwright/test";

/**
 * Task #591 — Plattform-Links im Header und Footer wirklich erreichbar halten.
 *
 * Schreibt die in PLATFORM_LINKS und FOOTER_LINKS (layout.tsx) hinterlegten
 * Ziele als E2E-Spec fest. Ändert jemand einen href, schlägt der Test an.
 *
 * Geprüft wird ausschließlich, dass die gerenderten href-Attribute exakt den
 * definierten Werten entsprechen — keine echten HTTP-Requests an assistenztreff.de
 * (wäre flaky). Die Existenz echter Rechtliches-Ziele (non-#, https:// oder /)
 * wird im bestehenden dienstplan-rechtsseiten-oeffentlich.spec.ts abgesichert.
 */

// Erwartete Werte aus layout.tsx PLATFORM_LINKS
const EXPECTED_PLATFORM_LINKS = [
  { label: "Leistungen", href: "https://assistenztreff.de/leistungen" },
  { label: "Handbuch", href: "/handbuch" },
  { label: "Kontakt", href: "https://assistenztreff.de/kontakt" },
] as const;

// Erwartete Werte aus layout.tsx FOOTER_LINKS + Barrierefreiheit
const EXPECTED_FOOTER_LINKS = [
  { label: "Impressum", href: "https://assistenztreff.de/impressum" },
  { label: "Datenschutz", href: "https://assistenztreff.de/datenschutzerklaerung" },
  { label: "Kontakt", href: "https://assistenztreff.de/kontakt" },
  { label: "Barrierefreiheit", href: "/barrierefreiheit" },
] as const;

test.describe("Plattform-Links Header (Desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Plattform-Nav zeigt alle Links mit korrektem href", async ({ page }) => {
    // Dev-Auto-Login meldet automatisch an; Dashboard erscheint.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
      timeout: 20_000,
    });

    const nav = page.getByRole("navigation", { name: "Plattform" });
    await expect(nav).toBeVisible();

    for (const { label, href } of EXPECTED_PLATFORM_LINKS) {
      const link = nav.getByRole("link", { name: label });
      await expect(link, `Header-Link "${label}" muss sichtbar sein`).toBeVisible();
      const actualHref = await link.getAttribute("href");
      expect(actualHref, `Header-Link "${label}" soll auf "${href}" zeigen`).toBe(href);
    }
  });
});

test.describe("Plattform-Links Header (Mobil)", () => {
  test.use({ viewport: { width: 400, height: 874 } });

  test("Hamburger-Menü zeigt alle Plattform-Links mit korrektem href", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
      timeout: 20_000,
    });

    // Hamburger öffnen
    const hamburger = page.getByTestId("platform-header-hamburger");
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    const menu = page.getByTestId("mobile-full-menu");
    await expect(menu).toBeVisible();

    for (const { label, href } of EXPECTED_PLATFORM_LINKS) {
      const link = menu.getByRole("link", { name: label });
      await expect(link, `Mobil-Menü-Link "${label}" muss sichtbar sein`).toBeVisible();
      const actualHref = await link.getAttribute("href");
      expect(actualHref, `Mobil-Menü-Link "${label}" soll auf "${href}" zeigen`).toBe(href);
    }

    // Menü schließen
    await page.getByTestId("mobile-full-menu-close").click();
    await expect(menu).not.toBeVisible();
  });
});

test.describe("Plattform-Links Footer", () => {
  test("Footer-Nav zeigt alle Rechtliches-Links mit korrektem href", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
      timeout: 20_000,
    });

    const nav = page.getByRole("navigation", { name: "Rechtliches" });
    await expect(nav).toBeVisible();

    for (const { label, href } of EXPECTED_FOOTER_LINKS) {
      const link = nav.getByRole("link", { name: label });
      await expect(link, `Footer-Link "${label}" muss sichtbar sein`).toBeVisible();
      const actualHref = await link.getAttribute("href");
      expect(actualHref, `Footer-Link "${label}" soll auf "${href}" zeigen`).toBe(href);
    }
  });

  test("Footer zeigt Copyright-Hinweis", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
      timeout: 20_000,
    });

    const footer = page.getByRole("contentinfo");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText("AssistenzTreff");
  });
});
