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
 * - Mobil (400px): Header scrollt weg, Dienstplanleiste klebt oben; das
 *   Vollbild-Menue (Hamburger im Plattform-Header, fixed) bleibt auch bei
 *   gescrolltem Inhalt voll sichtbar und schliessbar.
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
  // Testdaten-Unabhaengigkeit: Die geteilte Test-DB kann so wenig Inhalt
  // haben, dass die Seite kaum scrollbar ist. Ein Spacer im <main> garantiert
  // genuegend Scrollweg — geprueft wird das Sticky-Verhalten, nicht die
  // Inhaltsmenge.
  await page.evaluate(() => {
    if (!document.querySelector("[data-testid='e2e-scroll-spacer']")) {
      const spacer = document.createElement("div");
      spacer.setAttribute("data-testid", "e2e-scroll-spacer");
      spacer.style.height = "1500px";
      // WICHTIG: in den Seiten-Container (erstes Kind von <main>) haengen,
      // nicht in <main> selbst — sticky-Elemente kleben nur innerhalb ihres
      // Eltern-Containers; ein Spacer DAHINTER wuerde die sticky Kopfzeile
      // beim Scrollen aus dem Viewport schieben.
      const pageRoot = document.querySelector("main")?.firstElementChild;
      pageRoot?.appendChild(spacer);
    }
  });
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
  // den Viewport dann deutlich, sodass der Plattform-Header (~80px)
  // garantiert VOLLSTAENDIG aus dem Viewport scrollen kann.
  test.use({ viewport: { width: 400, height: 700 } });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Monatsgitter erzwingen (Default, aber explizit gegen localStorage-Drift
    // aus Nachbar-Specs): garantiert scrollbaren Inhalt auch ohne Schichten.
    await page.evaluate(() => localStorage.setItem("dienstplan.mobileView", "grid"));
  });

  test("Header scrollt weg, Dienstplanleiste klebt oben, Vollbild-Menue bleibt nutzbar", async ({
    page,
  }) => {
    await openDienstplan(page);

    const platformHeader = page.getByTestId("platform-header");
    const hamburger = page.getByTestId("platform-header-hamburger");
    const fullMenu = page.getByTestId("mobile-full-menu");

    // Ausgangslage: Plattform-Header mit Hamburger sichtbar, Menue zu.
    await expect(platformHeader).toBeInViewport();
    await expect(hamburger).toBeInViewport();
    await expect(fullMenu).not.toBeVisible();

    // Vollbild-Menue oeffnen: Es ist `fixed` und muss unabhaengig von der
    // Scroll-Position voll sichtbar bleiben.
    await hamburger.click();
    await expect(fullMenu).toBeInViewport();
    await expect(fullMenu.getByRole("link", { name: "Dashboard" })).toBeVisible();

    // Bei geoeffnetem Menue nach unten scrollen: Das Menue bleibt als
    // fixed-Element vollstaendig im Viewport ...
    await scrollLayoutToBottom(page);
    await expect(fullMenu).toBeInViewport();

    // ... und laesst sich weiterhin schliessen.
    await fullMenu.getByTestId("mobile-full-menu-close").click();
    await expect(fullMenu).not.toBeVisible();

    // Nach dem Schliessen (Seite ist weiterhin unten): Der Plattform-Header
    // (samt Hamburger) ist weggescrollt, die Dienstplanleiste klebt oben.
    await expect(platformHeader).not.toBeInViewport();
    await expectMonthLabelStickyAtTop(page);
    await expect(page.getByTestId("prev-month")).toBeInViewport();
    await expect(page.getByTestId("next-month")).toBeInViewport();

    // Zurueck nach oben: Der Hamburger erscheint wieder und das Menue laesst
    // sich erneut oeffnen (kompletter Roundtrip).
    await scrollLayoutToTop(page);
    await expect(hamburger).toBeInViewport();
    await hamburger.click();
    await expect(fullMenu).toBeInViewport();
  });
});
