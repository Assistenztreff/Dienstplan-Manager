import { test, expect } from "@playwright/test";

/**
 * Task #281 — Der Test-Nutzer-Wechsler ist im Dev-Modus wieder sichtbar.
 *
 * Gegenstück zum Prod-Spec `dienstplan-prod-dev-switcher-hidden.spec.ts`:
 * Der isolierte E2E-Stack läuft im Vite-DEV-Modus (Auto-Dev-Login aktiv),
 * dort MUSS der Umschalter in der Desktop-Sub-Navigation erscheinen —
 * sonst ist das Dev-Werkzeug wieder still verschwunden (Regression aus dem
 * Header-Redesign).
 */

test.describe("Dev-Modus: Test-Nutzer-Wechsler sichtbar", () => {
  // Der Umschalter ist nur ab md sichtbar — Desktop-Viewport nötig.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Umschalter erscheint in der Sub-Navigation und listet Test-Nutzer", async ({ page }) => {
    await page.goto("/");

    // Auto-Dev-Login: App-Shell mit Navigation erscheint ohne Formular.
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 20_000 });

    // Der Dev-Umschalter ist gemountet und sichtbar.
    const trigger = page.locator('[aria-label="Test-Nutzer wechseln"]');
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    // Er öffnet sich und bietet mindestens einen Test-Nutzer an.
    await trigger.click();
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10_000 });

    // Die geöffnete Liste muss IM Viewport bleiben und bei Bedarf scrollen.
    // Regression: die Tailwind-v3-Kurzform fuer CSS-Variablen in eckigen
    // Klammern (ohne var()) erzeugt unter Tailwind v4 ungueltiges CSS. Die
    // Hoehenbegrenzung des Select-Menues fiel damit weg und die Liste wuchs
    // mit jedem Testaccount unter den Bildschirmrand — die unteren Eintraege
    // waren nicht mehr erreichbar.
    const listbox = page.getByRole("listbox");
    const box = await listbox.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

    // Scrollbar/Scrollfunktion: der scrollende Bereich ist entweder selbst
    // schon länger als sichtbar (dann muss er scrollbar sein) oder passt
    // komplett hinein — beides ist in Ordnung, verdeckte Einträge nicht.
    const overflow = await listbox.evaluate((el) => {
      const scroller =
        el.scrollHeight > el.clientHeight
          ? el
          : (Array.from(el.querySelectorAll("*")) as HTMLElement[]).find(
              (n) => n.scrollHeight > n.clientHeight,
            ) ?? el;
      return { hidden: scroller.scrollHeight - scroller.clientHeight, scrollable: getComputedStyle(scroller).overflowY };
    });
    if (overflow.hidden > 0) {
      expect(["auto", "scroll"]).toContain(overflow.scrollable);
    }
  });
});
