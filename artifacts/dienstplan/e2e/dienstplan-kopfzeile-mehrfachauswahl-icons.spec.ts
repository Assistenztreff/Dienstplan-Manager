import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { TeamTestHarness } from "./helpers/teams";
import { openHeaderOverflow, startSelectionMode } from "./helpers/header";

/**
 * Regressionstest: Mehrfachauswahl- und Export-Aktionen werfen die adaptive
 * Kopfzeile nicht auf die Labels-Stufe zurueck, und Team-Menue +
 * Assistenten-Filter ueberlappen sich in keinem Zustand.
 *
 * Hintergrund (Bug): `isSelectionMode` war Teil des Mess-Schluessels der
 * Kopfzeile — jeder Zustandswechsel setzte die Stufe hart auf "labels"
 * zurueck. Die Neumessung eskalierte nicht zuverlaessig zurueck auf "icons",
 * weil die schrumpfbaren Selects sich visuell UEBERLAPPTEN statt messbar
 * ueberzulaufen. Ergebnis: Buttons sprangen auf Labels, Team-Menue und
 * Assistenten-Filter schoben sich uebereinander.
 *
 * Seit Task #856 liegen PDF-Export, Mehrfachauswahl-Einstieg und
 * Abwesenheitskalender im Ueberlauf-Menue (`header-overflow`); als
 * beschriftbarer Referenz-Button in der Hauptleiste dient der
 * "Senden"-Button (`confirm-all-drafts`).
 *
 * Deckt ab:
 * - Icon-Stufe (schmaler Desktop-Viewport): bleibt nach Aktivieren UND
 *   Beenden der Mehrfachauswahl erhalten (Senden-Button unbeschriftet,
 *   kein Ruecksprung auf Labels).
 * - Team-Switcher und Assistenten-Filter ueberlappen sich horizontal nicht
 *   (boundingBox), weder vor noch waehrend noch nach der Auswahl.
 * - Labels-Stufe (breiter Viewport): Beschriftungen bleiben beim Umschalten
 *   erhalten; die Menue-Eintraege im Ueberlauf-Menue sind IMMER beschriftet,
 *   unabhaengig von der Header-Stufe.
 * - PDF-Export aus dem Menue in der Icon-Stufe: `isExporting` haengt am
 *   remeasureKey statt am contentKey — der Senden-Button springt waehrend
 *   des Exports nicht kurz auf seine Beschriftung (MutationObserver faengt
 *   auch nur wenige Frames sichtbare Label-Blitzer).
 */

let h: TeamTestHarness;

test.beforeAll(async () => {
  // Frisches Dienstleister-Konto (premium): Team-Switcher ist nur fuer
  // Dienstleister sichtbar — exakt der Fall aus dem Bug-Screenshot. Ein
  // Assistent, damit auch der Assistenten-Filter rendert.
  h = await TeamTestHarness.login();
  await h.becomeDienstleister();
  await h.createUser({ role: "assistant", name: "E2E Kopfzeile Assistentin" });
});

test.afterAll(async () => {
  await h.cleanup();
});

/** Horizontale Bounding-Boxen von Team-Switcher und Assistenten-Filter. */
async function headerSelectBoxes(page: Page) {
  const teamTrigger = page.getByRole("combobox", { name: "Team auswählen" });
  const assistantTrigger = page.getByTestId("assistant-select");
  await expect(teamTrigger).toBeVisible();
  await expect(assistantTrigger).toBeVisible();
  const teamBox = await teamTrigger.boundingBox();
  const assistantBox = await assistantTrigger.boundingBox();
  expect(teamBox, "Team-Switcher hat keine BoundingBox").not.toBeNull();
  expect(assistantBox, "Assistenten-Filter hat keine BoundingBox").not.toBeNull();
  return { teamBox: teamBox!, assistantBox: assistantBox! };
}

/** Prueft, dass sich Team-Switcher und Assistenten-Filter nicht ueberlappen. */
async function expectNoSelectOverlap(page: Page, label: string) {
  const { teamBox, assistantBox } = await headerSelectBoxes(page);
  // Der Team-Switcher steht links vom Filter; sein rechter Rand darf den
  // linken Rand des Filters nicht ueberragen (kleine Toleranz fuer Borders).
  expect(
    teamBox.x + teamBox.width,
    `${label}: Team-Switcher (bis ${teamBox.x + teamBox.width}px) ueberlappt den Assistenten-Filter (ab ${assistantBox.x}px)`,
  ).toBeLessThanOrEqual(assistantBox.x + 1);
}

test.describe("Icon-Stufe bei schmalem Desktop-Viewport", () => {
  // Seit dem Ueberlauf-Menue (Task #856) ist die Hauptleiste deutlich
  // schmaler — 1024px reicht nicht mehr zuverlaessig fuer die Icon-Stufe,
  // daher ein engerer Viewport (immer noch md+, also Desktop-Layout).
  test.use({ viewport: { width: 900, height: 800 } });

  test("Mehrfachauswahl an/aus laesst die Icon-Stufe stehen, ohne Ueberlappung", async ({ page }) => {
    test.setTimeout(60000);
    await loginViaUi(page, h.email, h.password);
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    const sendBtn = page.getByTestId("confirm-all-drafts");

    // Vorbedingung: Icon-Stufe MUSS aktiv sein (Senden-Button ohne
    // Beschriftung) — sonst prueft der Test nicht den Bug-Fall.
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toHaveText("");
    await expectNoSelectOverlap(page, "vor der Auswahl");

    // --- Mehrfachauswahl ueber das Ueberlauf-Menue aktivieren -------------
    await startSelectionMode(page);
    // Aktiver Zustand: X-Button ("Auswahl beenden") in der Hauptleiste; die
    // uebrigen Buttons springen NICHT auf Labels zurueck.
    const endButton = page.getByRole("button", { name: "Auswahl beenden" });
    await expect(sendBtn).toHaveText("");
    await expectNoSelectOverlap(page, "waehrend der Auswahl");

    // --- Auswahl wieder beenden ------------------------------------------
    await endButton.click();
    await expect(page.getByTestId("toggle-selection-mode")).toHaveCount(0);
    await expect(sendBtn).toHaveText("");
    await expectNoSelectOverlap(page, "nach dem Beenden");

    // --- PDF-Export aus dem Menue: kein kurzes Aufspringen auf Labels -----
    // Ein MutationObserver auf der Kopfzeile protokolliert JEDE
    // Textaenderung des Senden-Buttons — auch ein nur wenige Frames
    // sichtbares Label-Flackern (der alte Bug: isExporting im contentKey
    // setzte die Mess-Stufe hart auf "labels" zurueck) wird so erkannt.
    await page.evaluate(() => {
      const w = window as unknown as {
        __labelFlashes: string[];
        __labelObserver?: MutationObserver;
      };
      w.__labelFlashes = [];
      const record = () => {
        const text =
          document
            .querySelector('[data-testid="confirm-all-drafts"]')
            ?.textContent?.trim() ?? "";
        // Der Icon-only-Button darf hoechstens den Entwurfszaehler-Badge
        // tragen (reine Ziffern) — jede Wort-Beschriftung ist ein Blitzer.
        if (text !== "" && !/^\d+$/.test(text)) {
          w.__labelFlashes.push(`confirm-all-drafts: ${text}`);
        }
      };
      const observer = new MutationObserver(record);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      w.__labelObserver = observer;
    });

    // Der Export laeuft ins Leere (frisches Konto ohne Dienste → Toast statt
    // Download) — fuer den Bug zaehlt nur der isExporting-Zustandswechsel.
    // Der Toast markiert zuverlaessig das ENDE des Export-Laufs (erst danach
    // den Observer auslesen, sonst wird zu frueh abgeklemmt).
    await openHeaderOverflow(page);
    await page.getByTestId("simple-month-export").click();
    await expect(
      page.getByText("Keine bestätigten Dienste oder Abwesenheiten in diesem Monat."),
    ).toBeVisible();

    const flashes = await page.evaluate(() => {
      const w = window as unknown as {
        __labelFlashes: string[];
        __labelObserver?: MutationObserver;
      };
      w.__labelObserver?.disconnect();
      return w.__labelFlashes;
    });
    expect(
      flashes,
      `Senden-Button sprang waehrend des Exports kurz auf sein Label: ${flashes.join(", ")}`,
    ).toEqual([]);
    await expect(sendBtn).toHaveText("");
    await expectNoSelectOverlap(page, "nach dem Export");
  });
});

test.describe("Labels-Stufe bei breitem Viewport (keine Regression)", () => {
  test.use({ viewport: { width: 1600, height: 800 } });

  test("Beschriftungen bleiben beim Umschalten der Mehrfachauswahl erhalten", async ({ page }) => {
    test.setTimeout(60000);
    await loginViaUi(page, h.email, h.password);
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    const sendBtn = page.getByTestId("confirm-all-drafts");

    // Vorbedingung: Labels-Stufe (Senden-Button beschriftet).
    await expect(sendBtn).toContainText("Senden");
    await expectNoSelectOverlap(page, "vor der Auswahl (breit)");

    // Menue-Eintraege sind unabhaengig von der Header-Stufe IMMER
    // beschriftet.
    await openHeaderOverflow(page);
    await expect(page.getByTestId("simple-month-export")).toContainText(
      "Monat als PDF exportieren",
    );
    await expect(page.getByTestId("toggle-selection-mode")).toContainText("Auswählen");
    await expect(page.getByTestId("open-abwesenheits-kalender")).toContainText(
      "Abwesenheit eintragen",
    );

    // Touch-Ziele: jeder Menue-Eintrag muss mind. 44px hoch sein
    // (DESIGN-GUIDELINES, Touch-Ziele auf Mobile) — das Menue ist der
    // einzige Zugang zu diesen Aktionen.
    for (const testId of [
      "simple-month-export",
      "toggle-selection-mode",
      "open-abwesenheits-kalender",
    ]) {
      // offsetHeight statt boundingBox: die Radix-Oeffnungsanimation
      // skaliert das Menue kurzzeitig (<1), was die Bounding-Box unter
      // 44px druecken wuerde; die Layout-Hoehe ist transform-unabhaengig.
      const height = await page
        .getByTestId(testId)
        .evaluate((el) => (el as HTMLElement).offsetHeight);
      expect(
        height,
        `${testId} ist nur ${height}px hoch (mind. 44px gefordert)`,
      ).toBeGreaterThanOrEqual(44);
    }

    // Auswahl aktivieren: X-Button erscheint, die uebrigen Buttons behalten
    // ihre Beschriftung (kein Stufenwechsel noetig).
    await page.getByTestId("toggle-selection-mode").click();
    await expect(page.getByRole("button", { name: "Auswahl beenden" })).toBeVisible();
    await expect(sendBtn).toContainText("Senden");
    await expectNoSelectOverlap(page, "waehrend der Auswahl (breit)");

    // Beenden: der X-Button verschwindet, die Beschriftungen bleiben.
    await page.getByRole("button", { name: "Auswahl beenden" }).click();
    await expect(page.getByTestId("toggle-selection-mode")).toHaveCount(0);
    await expect(sendBtn).toContainText("Senden");
    await expectNoSelectOverlap(page, "nach dem Beenden (breit)");
  });
});
