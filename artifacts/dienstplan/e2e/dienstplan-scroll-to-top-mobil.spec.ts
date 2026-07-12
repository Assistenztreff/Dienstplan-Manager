import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";

/**
 * E2E-Test: Der schwebende "Nach oben"-Button (mobil, unten rechts) erscheint
 * nach ~300px Scrolltiefe, scrollt beim Tipp sanft zurueck zum Seitenanfang
 * und verschwindet dort wieder. Auf Desktop-Viewports bleibt er komplett
 * ausgeblendet (md:hidden → display: none).
 *
 * WICHTIG zur Pruef-Technik: Der Button wird per opacity/pointer-events
 * ein- und ausgeblendet (Element bleibt immer im DOM und hat eine Groesse).
 * Playwrights isVisible()/toBeVisible() ignorieren opacity — deshalb wird
 * hier explizit auf getComputedStyle(...).opacity bzw. .pointerEvents
 * geprueft. Gescrollt wird der INNERE Layout-Container
 * (layout-scroll-container); das Dokument selbst scrollt nie.
 *
 * Regressionsschutz gegen Layout-Umbauten in layout.tsx (z. B. ein neuer
 * Wrapper, der das Scrollen auf ein anderes Element verlagert und damit den
 * Scroll-Listener des Buttons ins Leere laufen laesst).
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dienstplan.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin1234";

// Muss zur Konstante SCROLL_TOP_THRESHOLD in layout.tsx passen (300px).
const SCROLL_TOP_THRESHOLD = 300;

async function openDienstplan(page: Page): Promise<void> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();
  // Deterministisch scrollbaren Inhalt sicherstellen: In der Test-DB kann das
  // Monatsgitter zu kurz sein, um die 300px-Schwelle zu ueberschreiten
  // (haengt von geseedeten Schichten ab). Der Spacer haengt IM <main> des
  // echten Layout-Scroll-Containers — die Verkabelung Button <-> Container
  // (Scroll-Listener, scrollTo) wird also unverfaelscht getestet.
  await page.evaluate(() => {
    document
      .querySelector("main")
      ?.insertAdjacentHTML(
        "beforeend",
        '<div data-testid="e2e-scroll-spacer" style="height:2000px"></div>',
      );
  });
}

async function scrollLayoutTo(page: Page, top: number): Promise<void> {
  const container = page.getByTestId("layout-scroll-container");
  await container.evaluate((el, target) => {
    el.scrollTop = target;
  }, top);
}

async function getScrollTop(page: Page): Promise<number> {
  return page.getByTestId("layout-scroll-container").evaluate((el) => el.scrollTop);
}

/** Effektive Sichtbarkeit: opacity > 0 UND pointer-events aktiv. */
async function isEffectivelyVisible(button: Locator): Promise<boolean> {
  return button.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return parseFloat(style.opacity) > 0.5 && style.pointerEvents !== "none";
  });
}

test.describe("Dienstplan: Nach-oben-Button (Mobil 400px)", () => {
  // Kompakte Smartphone-Hoehe: Das Monatsgitter ueberragt den Viewport
  // deutlich, sodass garantiert tiefer als die 300px-Schwelle gescrollt
  // werden kann.
  test.use({ viewport: { width: 400, height: 700 } });

  test.beforeEach(async ({ page }) => {
    // Erster Seitenaufruf in frischem Kontext laedt das komplette Bundle
    // ueber den Proxy und kann deutlich laenger als 30s dauern.
    test.setTimeout(120_000);
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Monatsgitter erzwingen (gegen localStorage-Drift aus Nachbar-Specs):
    // garantiert scrollbaren Inhalt auch ohne Schichten.
    await page.evaluate(() => localStorage.setItem("dienstplan.mobileView", "grid"));
  });

  test("Button erscheint nach tiefem Scrollen, scrollt zurueck auf 0 und verschwindet wieder", async ({
    page,
  }) => {
    await openDienstplan(page);

    const button = page.getByTestId("scroll-to-top");

    // Der Button ist immer im DOM (nur per opacity ausgeblendet) und auf
    // Mobil NICHT display:none.
    await expect(button).toBeAttached();
    const displayAtStart = await button.evaluate((el) => window.getComputedStyle(el).display);
    expect(displayAtStart, "Auf Mobil darf der Button nicht display:none sein").not.toBe("none");

    // 1) Seitenanfang: Button unsichtbar und nicht klickbar.
    expect(await getScrollTop(page)).toBe(0);
    expect(await isEffectivelyVisible(button)).toBe(false);

    // 2) Unterhalb der Schwelle (~300px) bleibt er unsichtbar.
    await scrollLayoutTo(page, SCROLL_TOP_THRESHOLD - 100);
    await expect
      .poll(async () => getScrollTop(page), {
        message: "Der Layout-Container muss auf die Zwischenposition scrollen",
      })
      .toBeGreaterThan(SCROLL_TOP_THRESHOLD - 150);
    // Kurz warten, damit ein (fehlerhaftes) Einblenden sichtbar wuerde.
    await page.waitForTimeout(300);
    expect(
      await isEffectivelyVisible(button),
      "Unterhalb der 300px-Schwelle muss der Button unsichtbar bleiben",
    ).toBe(false);

    // 3) Tief scrollen (deutlich ueber die Schwelle): Button erscheint.
    await scrollLayoutTo(page, SCROLL_TOP_THRESHOLD + 400);
    await expect
      .poll(async () => getScrollTop(page), {
        message: "Der Layout-Container muss ueber die 300px-Schwelle scrollen",
      })
      .toBeGreaterThan(SCROLL_TOP_THRESHOLD);
    await expect
      .poll(async () => isEffectivelyVisible(button), {
        message: "Nach tiefem Scrollen muss der Nach-oben-Button eingeblendet sein",
      })
      .toBe(true);

    // 4) Tipp auf den Button: sanfter Scroll zurueck auf 0.
    await button.click();
    await expect
      .poll(async () => getScrollTop(page), {
        message: "Der Klick muss den Container ganz nach oben scrollen",
        timeout: 10_000,
      })
      .toBe(0);

    // 5) Oben angekommen: Button verschwindet wieder (opacity 0, keine
    //    pointer-events).
    await expect
      .poll(async () => isEffectivelyVisible(button), {
        message: "Am Seitenanfang muss der Button wieder ausgeblendet sein",
      })
      .toBe(false);
  });
});

test.describe("Dienstplan: Nach-oben-Button bleibt auf Desktop ausgeblendet (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Monatsgitter erzwingen: garantiert scrollbaren Inhalt.
    await page.evaluate(() => localStorage.setItem("dienstplan.desktopView", "grid"));
  });

  test("Button ist auch nach tiefem Scrollen display:none", async ({ page }) => {
    await openDienstplan(page);

    const button = page.getByTestId("scroll-to-top");
    await expect(button).toBeAttached();

    // Ausgangslage: md:hidden → display none.
    expect(await button.evaluate((el) => window.getComputedStyle(el).display)).toBe("none");

    // Auch nach tiefem Scrollen darf der Button auf Desktop nie erscheinen.
    await scrollLayoutTo(page, SCROLL_TOP_THRESHOLD + 400);
    await expect
      .poll(async () => getScrollTop(page), {
        message: "Der Layout-Container muss ueber die 300px-Schwelle scrollen",
      })
      .toBeGreaterThan(SCROLL_TOP_THRESHOLD);
    await page.waitForTimeout(300);
    expect(
      await button.evaluate((el) => window.getComputedStyle(el).display),
      "Auf Desktop muss der Button display:none bleiben",
    ).toBe("none");
  });
});
