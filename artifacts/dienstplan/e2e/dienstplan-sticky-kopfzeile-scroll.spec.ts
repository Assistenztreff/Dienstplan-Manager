import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test: Die Dienstplan-Kopfzeile (Monatsnavigation, Filter, Aktionen)
 * bleibt beim Scrollen dauerhaft oben sichtbar (sticky), waehrend
 * Plattform-Header und App-Menueleiste mit der Seite nach oben wegscrollen.
 *
 * Scroll-Modell: Das Dokument selbst scrollt nie — gescrollt wird der innere
 * Layout-Container (`layout-scroll-container`). Plattform-Header und
 * Sub-Navigation stehen IN diesem Container und verschwinden beim
 * Runterscrollen; nur die seiteneigene sticky Kopfzeile des Dienstplans
 * (erkennbar am `month-label`) klebt am oberen Viewport-Rand.
 *
 * Deckt ab (Regressionsschutz gegen z. B. einen neuen Wrapper mit overflow,
 * der den sticky-Kontext zerstoert):
 * - Desktop (1280px): Header + Desktop-Menueleiste scrollen weg,
 *   Dienstplanleiste klebt oben.
 * - Mobil (400px): Header + App-Menue-Leiste scrollen weg, Dienstplanleiste
 *   klebt oben; der App-Menue-Drawer (fixed) bleibt auch bei gescrolltem
 *   Inhalt voll sichtbar und schliessbar.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Toleranz fuer die "klebt oben"-Pruefung: Oberkante der sticky Leiste liegt
// am Container-Rand (y=0); das month-label sitzt mit etwas Padding darunter.
const STICKY_TOP_MAX_Y = 80;

async function openDienstplan(page: Page): Promise<void> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
}

/**
 * Scrollt den inneren Layout-Container ganz nach unten und stellt sicher,
 * dass tatsaechlich gescrollt wurde (sonst waere die sticky-Pruefung
 * bedeutungslos, z. B. wenn der Inhalt zu kurz ist oder ein Umbau das
 * Scrollen versehentlich auf das Dokument verlagert haette).
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

test.describe("Dienstplan: Kopfzeile bleibt beim Scrollen sichtbar (Desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    // Erster Seitenaufruf in frischem Kontext laedt das komplette Bundle
    // ueber den Proxy und kann deutlich laenger als 30s dauern.
    test.setTimeout(120_000);
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Monatsgitter erzwingen: Es ist unabhaengig von vorhandenen Schichten
    // hoch genug, damit der Container garantiert scrollbar ist (die
    // Tabellenansicht kann bei wenigen Assistenten kuerzer als der
    // Viewport sein).
    await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  });

  test("Plattform-Header und Menueleiste scrollen weg, Dienstplanleiste klebt oben", async ({
    page,
  }) => {
    await openDienstplan(page);

    // Ausgangslage: Plattform-Header + Desktop-Menueleiste + Kopfzeile sichtbar.
    const platformHeader = page.getByTestId("platform-header");
    const subNav = page.getByTestId("app-subnav-desktop");
    await expect(platformHeader).toBeInViewport();
    await expect(subNav).toBeInViewport();
    await expect(page.getByTestId("month-label")).toBeVisible();

    await scrollLayoutToBottom(page);

    // Plattform-Huelle ist nach oben weggescrollt ...
    await expect(platformHeader).not.toBeInViewport();
    await expect(subNav).not.toBeInViewport();

    // ... die Dienstplanleiste klebt weiterhin oben am Viewport-Rand.
    await expectMonthLabelStickyAtTop(page);

    // Auch die Aktions-Elemente der Leiste bleiben nutzbar sichtbar.
    await expect(page.getByTestId("prev-month")).toBeInViewport();
    await expect(page.getByTestId("next-month")).toBeInViewport();
  });
});

test.describe("Dienstplan: Kopfzeile bleibt beim Scrollen sichtbar (Mobil 400px)", () => {
  // Bewusst 700px Hoehe (kompaktes Smartphone): Das Monatsgitter ueberragt
  // den Viewport dann deutlich, sodass Plattform-Header + App-Menue-Leiste
  // (~110px) garantiert VOLLSTAENDIG aus dem Viewport scrollen koennen.
  test.use({ viewport: { width: 400, height: 700 } });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Monatsgitter erzwingen (Default, aber explizit gegen localStorage-Drift
    // aus Nachbar-Specs): garantiert scrollbaren Inhalt auch ohne Schichten.
    await page.evaluate(() => localStorage.setItem("dienstplan.mobileView", "grid"));
  });

  test("App-Menue-Leiste scrollt weg, Dienstplanleiste klebt oben, Drawer bleibt nutzbar", async ({
    page,
  }) => {
    await openDienstplan(page);

    const platformHeader = page.getByTestId("platform-header");
    const appMenuBar = page.getByTestId("app-menu-bar");
    const drawer = page.getByTestId("app-menu-drawer");

    // Ausgangslage: Plattform-Header + App-Menue-Leiste sichtbar, Drawer zu.
    await expect(platformHeader).toBeInViewport();
    await expect(appMenuBar).toBeInViewport();
    await expect(drawer).not.toBeInViewport();

    // Drawer oeffnen: Er ist `fixed` und muss unabhaengig von der
    // Scroll-Position voll sichtbar bleiben.
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

    // Nach dem Schliessen (Seite ist weiterhin unten): Plattform-Header und
    // App-Menue-Leiste sind weggescrollt, die Dienstplanleiste klebt oben.
    await expect(platformHeader).not.toBeInViewport();
    await expect(appMenuBar).not.toBeInViewport();
    await expectMonthLabelStickyAtTop(page);
    await expect(page.getByTestId("prev-month")).toBeInViewport();
    await expect(page.getByTestId("next-month")).toBeInViewport();

    // Zurueck nach oben: Die App-Menue-Leiste erscheint wieder und der Drawer
    // laesst sich erneut oeffnen (kompletter Roundtrip).
    await scrollLayoutToTop(page);
    await expect(appMenuBar).toBeInViewport();
    await page.getByRole("button", { name: "App-Menü öffnen" }).click();
    await expect(drawer).toBeInViewport();
  });
});
