import { test, expect, type Page } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import { TeamTestHarness } from "./helpers/teams";

/**
 * Regressionstest: Mehrfachauswahl-Klick wirft die adaptive Kopfzeile nicht
 * mehr auf die Labels-Stufe zurueck, und Team-Menue + Assistenten-Filter
 * ueberlappen sich in keinem Zustand.
 *
 * Hintergrund (Bug): `isSelectionMode` war Teil des Mess-Schluessels der
 * Kopfzeile — jeder Klick auf Mehrfachauswahl setzte die Stufe hart auf
 * "labels" zurueck. Die Neumessung eskalierte nicht zuverlaessig zurueck auf
 * "icons", weil die schrumpfbaren Selects (Team-Switcher via min-w-0-Wrapper)
 * sich visuell UEBERLAPPTEN statt messbar ueberzulaufen (scrollWidth blieb
 * <= clientWidth). Ergebnis: Buttons sprangen auf Labels, Team-Menue und
 * Assistenten-Filter schoben sich uebereinander (Dienstleister, ~1024px).
 *
 * Deckt ab:
 * - Icon-Stufe bei ~1024px (Dienstleister mit Team-Switcher + Filter) bleibt
 *   nach Aktivieren UND Beenden der Mehrfachauswahl erhalten (Buttons
 *   unbeschriftet, kein Ruecksprung auf Labels).
 * - Team-Switcher und Assistenten-Filter ueberlappen sich horizontal nicht
 *   (boundingBox), weder vor noch waehrend noch nach der Auswahl.
 * - Labels-Stufe (breiter Viewport): Beschriftungen bleiben beim Umschalten
 *   erhalten — keine Regression durch den geaenderten Mess-Schluessel.
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

test.describe("Icon-Stufe bei ~1024px (Fall aus dem Screenshot)", () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test("Mehrfachauswahl an/aus laesst die Icon-Stufe stehen, ohne Ueberlappung", async ({ page }) => {
    test.setTimeout(60000);
    await loginViaUi(page, h.email, h.password);
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    const toggle = page.getByTestId("toggle-selection-mode");
    const exportBtn = page.getByTestId("simple-month-export");

    // Vorbedingung: Bei 1024px MUSS die Icon-Stufe aktiv sein (Buttons ohne
    // Beschriftung) — sonst prueft der Test nicht den Bug-Fall.
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("");
    await expect(exportBtn).toHaveText("");
    await expectNoSelectOverlap(page, "vor der Auswahl");

    // --- Mehrfachauswahl aktivieren -------------------------------------
    await toggle.click();
    // Aktiver Zustand: X-Button ("Auswahl beenden"), weiterhin unbeschriftet.
    const endButton = page.getByRole("button", { name: "Auswahl beenden" });
    await expect(endButton).toBeVisible();
    // Die uebrigen Buttons springen NICHT auf Labels zurueck.
    await expect(exportBtn).toHaveText("");
    await expectNoSelectOverlap(page, "waehrend der Auswahl");

    // --- Auswahl wieder beenden ------------------------------------------
    await endButton.click();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("");
    await expect(exportBtn).toHaveText("");
    await expectNoSelectOverlap(page, "nach dem Beenden");
  });
});

test.describe("Labels-Stufe bei breitem Viewport (keine Regression)", () => {
  test.use({ viewport: { width: 1600, height: 800 } });

  test("Beschriftungen bleiben beim Umschalten der Mehrfachauswahl erhalten", async ({ page }) => {
    test.setTimeout(60000);
    await loginViaUi(page, h.email, h.password);
    await page.goto("/dienstplan");
    await expect(page.getByRole("heading", { name: "Dienstplan", exact: true })).toBeVisible();

    const toggle = page.getByTestId("toggle-selection-mode");
    const exportBtn = page.getByTestId("simple-month-export");

    // Vorbedingung: Labels-Stufe (Buttons beschriftet).
    await expect(toggle).toContainText("Mehrfachauswahl");
    await expect(exportBtn).toContainText("Monats-PDF");
    await expectNoSelectOverlap(page, "vor der Auswahl (breit)");

    // Auswahl aktivieren: der Toggle wird zum X-Button, die uebrigen Buttons
    // behalten ihre Beschriftung (kein Stufenwechsel noetig).
    await toggle.click();
    await expect(page.getByRole("button", { name: "Auswahl beenden" })).toBeVisible();
    await expect(exportBtn).toContainText("Monats-PDF");
    await expectNoSelectOverlap(page, "waehrend der Auswahl (breit)");

    // Beenden: beschrifteter Mehrfachauswahl-Button kommt zurueck.
    await page.getByRole("button", { name: "Auswahl beenden" }).click();
    await expect(toggle).toContainText("Mehrfachauswahl");
    await expect(exportBtn).toContainText("Monats-PDF");
    await expectNoSelectOverlap(page, "nach dem Beenden (breit)");
  });
});
