import { test, expect, type Page, type Locator } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers/teams";

/**
 * Regressionstest: engere Seitenränder auf mobilen Seiten (Task #821).
 *
 * Hintergrund: Die horizontalen Innenabstände im Mobilmodus wurden von
 * p-4 (16 px) auf px-2 (8 px) reduziert (layout.tsx ~Zeile 800). Dieser
 * Test stellt sicher, dass keine der fünf Hauptseiten dabei einen
 * horizontalen Überlauf (Clipping / horizontale Scrollleiste) produziert.
 *
 * Viewport: 390 px × 844 px (iPhone-Standardbreite).
 *
 * Für jede der fünf Seiten wird geprüft:
 *  1. Ein seitenspezifisches Element ist sichtbar → Lazy-Load der Route
 *     und initiale Datenlast sind abgeschlossen, nicht nur die App-Shell.
 *  2. #hauptinhalt.scrollWidth <= #hauptinhalt.clientWidth → kein
 *     Inhalt ragt horizontal über den Container hinaus.
 *     (document.documentElement reicht nicht: der äußere Layout-Wrapper
 *     verwendet overflow-hidden und würde überbreite Descendants maskieren.)
 *  3. paddingLeft = 8 px, paddingRight = 8 px → px-2 ist aktiv, das
 *     Layout ist nicht auf den alten p-4-Wert zurückgefallen.
 *
 * Seiten:
 *  - Dashboard       /
 *  - Auswertungen    /auswertungen
 *  - Team-Verwaltung /team-verwaltung
 *  - Zeiterfassung   /zeiterfassung
 *  - Einstellungen   /einstellungen
 */

// 390 × 844 — Standard-Mobilbreite (iPhone 14).
test.use({ viewport: { width: 390, height: 844 } });

/**
 * Seitenspezifischer Locator, der erst sichtbar wird, wenn die
 * lazy-geladene Routen-Komponente und ihre initiale Datenlast fertig sind.
 *
 * Quellen (alle liegen innerhalb von #hauptinhalt):
 *  - Dashboard:       h2 "Dashboard"            (dashboard.tsx ~Z. 506)
 *  - Auswertungen:    [data-testid="fix-only-hint"]  (auswertungen.tsx ~Z. 449)
 *  - Team-Verwaltung: h2 "Team-Verwaltung"      (team-verwaltung.tsx ~Z. 1204)
 *  - Zeiterfassung:   h1 "Zeiterfassung"        (zeiterfassung.tsx ~Z. 603)
 *  - Einstellungen:   h2 "Abrechnungsgrundlagen" (erste, immer offene Gruppe)
 */
type PageEntry = {
  label: string;
  path: string;
  readyLocator: (page: Page) => Locator;
};

const PAGES: PageEntry[] = [
  {
    label: "Dashboard",
    path: "/",
    readyLocator: (page) => page.getByRole("heading", { name: "Dashboard" }),
  },
  {
    label: "Auswertungen",
    path: "/auswertungen",
    // "fix-only-hint" erscheint sobald die Seite und ihre Daten geladen sind
    // (außerhalb des Premium-Gates, immer sichtbar für Admin).
    readyLocator: (page) => page.getByTestId("fix-only-hint"),
  },
  {
    label: "Team-Verwaltung",
    path: "/team-verwaltung",
    readyLocator: (page) =>
      page.getByRole("heading", { name: "Team-Verwaltung" }),
  },
  {
    label: "Zeiterfassung",
    path: "/zeiterfassung",
    readyLocator: (page) =>
      page.getByRole("heading", { name: "Zeiterfassung" }),
  },
  {
    label: "Einstellungen",
    path: "/einstellungen",
    // Profil steckt seit der Neuordnung in der eingeklappten Gruppe
    // "Dienste und Struktur". Die erste Gruppe ist immer offen und damit der
    // verlaessliche Beweis, dass die Seite fertig gerendert hat.
    readyLocator: (page) =>
      page.getByRole("heading", { name: "Abrechnungsgrundlagen" }),
  },
];

test.describe("Mobilansicht: engere Seitenränder (px-2)", () => {
  test.beforeEach(async ({ page }) => {
    // Programmatischer Login — funktioniert in Dev- und Prod-Build-Stack
    // (kein Formular, direkte API-Session; page.request teilt den Cookie-Jar
    // mit dem Browser).
    const res = await page.request.post("/api/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.ok(), `Admin-Login fehlgeschlagen (${res.status()})`).toBe(true);
  });

  for (const { label, path, readyLocator } of PAGES) {
    test(`${label} (${path}): kein Überlauf, px-2-Innenabstand`, async ({
      page,
    }) => {
      test.setTimeout(40_000);

      await page.goto(path);

      // ── 1. Warten auf seitenspezifischen Bereitschafts-Indikator ─────────
      // #hauptinhalt ist Teil der permanenten Layout-Shell und wird bereits
      // sichtbar, bevor die lazy-geladene Routen-Komponente und ihre Daten
      // fertig sind. Erst das seitenspezifische Element beweist, dass die
      // Seite vollständig gerendert hat.
      await expect(readyLocator(page)).toBeVisible({ timeout: 30_000 });

      const hauptinhalt = page.locator("#hauptinhalt");

      // ── 2. Kein horizontaler Überlauf in #hauptinhalt ─────────────────────
      // scrollWidth > clientWidth zeigt, dass ein Kindelement breiter als der
      // Container ist — der Inhalt würde abgeschnitten. Wir prüfen auf
      // #hauptinhalt statt document.documentElement, weil der äußere
      // Layout-Wrapper overflow-hidden trägt und breitere Descendants dort
      // nicht in scrollWidth einfließen (layout.tsx ~Z. 767).
      const overflow = await hauptinhalt.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `${label}: #hauptinhalt.scrollWidth (${overflow.scrollWidth}px) übersteigt clientWidth (${overflow.clientWidth}px) — Inhalte werden abgeschnitten`,
      ).toBeLessThanOrEqual(overflow.clientWidth);

      // ── 3. px-2-Innenabstand am Haupt-Container ──────────────────────────
      // Tailwind px-2 = 0.5 rem. Bei Browser-Default 16 px/rem → 8 px.
      // Stellt sicher, dass kein Revert auf den alten p-4 (16 px) stattgefunden
      // hat und kein kantenloser Inhalt (0 px) entsteht.
      const padding = await hauptinhalt.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          left: parseFloat(style.paddingLeft),
          right: parseFloat(style.paddingRight),
        };
      });
      expect(
        padding.left,
        `${label}: paddingLeft sollte 8 px (px-2) sein, ist aber ${padding.left} px`,
      ).toBe(8);
      expect(
        padding.right,
        `${label}: paddingRight sollte 8 px (px-2) sein, ist aber ${padding.right} px`,
      ).toBe(8);
    });
  }
});
