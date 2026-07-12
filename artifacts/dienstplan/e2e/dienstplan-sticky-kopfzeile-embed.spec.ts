import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test: Sticky-Verhalten der Dienstplan-Kopfzeile im EMBED-MODUS
 * (?embed=1 — iframe-Einbettung in die AssistenzTreff-Plattform).
 *
 * Im Embed-Modus blendet das Layout den Plattform-Header-Platzhalter (und
 * den Plattform-Footer) aus — der Aufbau des Scroll-Containers aendert sich
 * also gegenueber dem normalen Modus. Der bestehende Sticky-Scroll-Test
 * (dienstplan-sticky-kopfzeile-scroll.spec.ts) deckt nur den normalen Modus
 * ab; dieser Spec stellt sicher, dass eine Layout-Aenderung das
 * Sticky-Verhalten nicht ausgerechnet dort bricht, wo echte eingebettete
 * Nutzer landen.
 *
 * Deckt ab:
 * - Desktop (1280px): Plattform-Header fehlt, App-Menueleiste scrollt weg,
 *   Dienstplanleiste (month-label) klebt oben am Viewport.
 * - Mobil (400px): Plattform-Header fehlt, Dienstplanleiste klebt oben,
 *   der App-Menue-Drawer (fixed) bleibt auch bei gescrolltem Inhalt
 *   voll sichtbar, bedienbar und schliessbar.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Toleranz fuer die "klebt oben"-Pruefung: Oberkante der sticky Leiste liegt
// am Container-Rand (y=0); das month-label sitzt mit etwas Padding darunter.
const STICKY_TOP_MAX_Y = 80;

/**
 * Oeffnet den Dienstplan explizit mit ?embed=1 (Aktivierung des Embed-Modus
 * ueber die iframe-URL; wird zusaetzlich in sessionStorage gemerkt).
 */
async function openDienstplanEmbedded(page: Page): Promise<void> {
  await page.goto("/dienstplan?embed=1");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
}

/** Der Plattform-Header-Platzhalter darf im Embed-Modus NICHT gerendert sein. */
async function expectNoPlatformHeader(page: Page): Promise<void> {
  await expect(page.getByTestId("platform-header")).toHaveCount(0);
}

/**
 * Scrollt den inneren Layout-Container ganz nach unten und stellt sicher,
 * dass tatsaechlich gescrollt wurde (sonst waere die sticky-Pruefung
 * bedeutungslos).
 */
async function scrollLayoutToBottom(page: Page): Promise<void> {
  const container = page.getByTestId("layout-scroll-container");
  await container.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(async () => container.evaluate((el) => el.scrollTop), {
      message: "Der Layout-Container muss scrollbar sein und gescrollt haben",
    })
    .toBeGreaterThan(100);
}

async function scrollLayoutToTop(page: Page): Promise<void> {
  const container = page.getByTestId("layout-scroll-container");
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect.poll(async () => container.evaluate((el) => el.scrollTop)).toBe(0);
}

/** Prueft, dass das Monatslabel sichtbar ist und oben am Viewport klebt. */
async function expectMonthLabelStickyAtTop(page: Page): Promise<void> {
  const monthLabel = page.getByTestId("month-label");
  await expect(monthLabel).toBeInViewport();
  const box = await monthLabel.boundingBox();
  expect(box, "month-label muss eine Bounding-Box haben").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeLessThanOrEqual(STICKY_TOP_MAX_Y);
}

test.describe("Embed-Modus: Dienstplanleiste klebt beim Scrollen oben (Desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    // Erster Seitenaufruf in frischem Kontext laedt das komplette Bundle
    // ueber den Proxy und kann deutlich laenger als 30s dauern.
    test.setTimeout(120_000);
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Monatsgitter erzwingen: unabhaengig von vorhandenen Schichten hoch
    // genug, damit der Container garantiert scrollbar ist.
    await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  });

  test("Plattform-Header fehlt, Menueleiste scrollt weg, Dienstplanleiste klebt oben", async ({
    page,
  }) => {
    await openDienstplanEmbedded(page);

    // Embed-Modus aktiv: Plattform-Header-Platzhalter ist NICHT im DOM.
    await expectNoPlatformHeader(page);

    // Die App-eigene Menueleiste bleibt auch im Embed-Modus sichtbar
    // (gehoert zur App, nicht zur Plattform-Huelle).
    const subNav = page.getByTestId("app-subnav-desktop");
    await expect(subNav).toBeInViewport();
    await expect(page.getByTestId("month-label")).toBeVisible();

    await scrollLayoutToBottom(page);

    // App-Menueleiste ist nach oben weggescrollt ...
    await expect(subNav).not.toBeInViewport();

    // ... die Dienstplanleiste klebt weiterhin oben am Viewport-Rand.
    await expectMonthLabelStickyAtTop(page);

    // Auch die Aktions-Elemente der Leiste bleiben nutzbar sichtbar.
    await expect(page.getByTestId("prev-month")).toBeInViewport();
    await expect(page.getByTestId("next-month")).toBeInViewport();
  });
});

test.describe("Embed-Modus: Dienstplanleiste klebt beim Scrollen oben (Mobil 400px)", () => {
  // Bewusst NUR 460px Hoehe: Im Embed-Modus fehlen Plattform-Header und
  // -Footer, der Inhalt ist also deutlich kuerzer als im normalen Modus.
  // Bei 700px Hoehe passt das Monatsgitter u. U. komplett in den Viewport
  // und der Container waere gar nicht scrollbar (die Scroll-Pruefung liefe
  // ins Leere; bei 560px blieben nur ~87px Scrollweg — zu knapp fuer die
  // 100px-Mindest-Scroll-Pruefung). 460px ist zudem realistisch: Im echten
  // iframe nehmen Plattform-Header + Browser-Chrome dem eingebetteten
  // Fenster erheblich Hoehe weg.
  test.use({ viewport: { width: 400, height: 460 } });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Monatsgitter erzwingen (explizit gegen localStorage-Drift aus
    // Nachbar-Specs): garantiert scrollbaren Inhalt auch ohne Schichten.
    await page.evaluate(() => localStorage.setItem("dienstplan.mobileView", "grid"));
  });

  test("Plattform-Header fehlt, Dienstplanleiste klebt oben, Drawer bleibt nutzbar", async ({
    page,
  }) => {
    await openDienstplanEmbedded(page);

    // Embed-Modus aktiv: Plattform-Header-Platzhalter ist NICHT im DOM.
    await expectNoPlatformHeader(page);

    const appMenuBar = page.getByTestId("app-menu-bar");
    const drawer = page.getByTestId("app-menu-drawer");

    // Ausgangslage: App-Menue-Leiste sichtbar, Drawer zu.
    await expect(appMenuBar).toBeInViewport();
    await expect(drawer).not.toBeInViewport();

    // Drawer oeffnen: Er ist `fixed` und muss unabhaengig von der
    // Scroll-Position voll sichtbar bleiben — auch im Embed-Modus.
    await page.getByRole("button", { name: "App-Menü öffnen" }).click();
    await expect(drawer).toBeInViewport();
    await expect(drawer.getByText("Dashboard")).toBeVisible();

    // Bei geoeffnetem Drawer nach unten scrollen: Der Drawer bleibt als
    // fixed-Element vollstaendig im Viewport ...
    await scrollLayoutToBottom(page);
    await expect(drawer).toBeInViewport();

    // ... und laesst sich weiterhin schliessen.
    await drawer.getByRole("button", { name: "Menü schließen" }).click();
    await expect(drawer).not.toBeInViewport();

    // Nach dem Schliessen (Seite ist weiterhin unten): App-Menue-Leiste ist
    // weggescrollt, die Dienstplanleiste klebt oben.
    await expect(appMenuBar).not.toBeInViewport();
    await expectMonthLabelStickyAtTop(page);
    await expect(page.getByTestId("prev-month")).toBeInViewport();
    await expect(page.getByTestId("next-month")).toBeInViewport();

    // Zurueck nach oben: Die App-Menue-Leiste erscheint wieder und der
    // Drawer laesst sich erneut oeffnen (kompletter Roundtrip im Embed-Modus).
    await scrollLayoutToTop(page);
    await expect(appMenuBar).toBeInViewport();
    await page.getByRole("button", { name: "App-Menü öffnen" }).click();
    await expect(drawer).toBeInViewport();
  });
});
