import { test, expect, type Page } from "@playwright/test";
import {
  registerFreeAccount,
  setAccountPlan,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Test: Free-Stundenlisten-Export + gesperrte Premium-Schalter.
 *
 * Free-Tarif:
 * - Auswertungen: Der Export-Popover bietet die "Stundenliste" (Dienste,
 *   Urlaub, Krank) als einzige aktive Option; Lohnexport/Zeitkonto/ZIP sind
 *   sichtbar, aber gesperrt (Lock + Premium-Hinweis). Der Stundenliste-
 *   Download läuft als .xlsx durch.
 * - Einstellungen: Die drei Schalter "Zeiterfassung aktivieren", "Pausen
 *   automatisch vorbefüllen", "Pausen von bezahlten Stunden abziehen" sind
 *   disabled und mit Lock-Icon + Premium-Verweis versehen.
 *
 * Premium-Tarif (nach Plan-Upgrade): Alles unverändert bedienbar — Schalter
 * aktiv, alle Export-Optionen frei.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf eigener
 * Test-DB). Seeding passiert VOR dem ersten goto (React-Query-Cache).
 */

const now = new Date();
const YEAR = now.getFullYear();
const MM = String(now.getMonth() + 1).padStart(2, "0");
// Fester Tag 10 im aktuellen Monat (keine Monatsrand-Effekte, keine
// Math.min-Kollaps-Falle bei relativen Tagen).
const DAY = "10";
const ASSISTANT_NAME = "Stundenliste Assistentin";

/** Session-Cookies des per API eingeloggten Kontos in den Browser übernehmen. */
async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

test.describe("Free-Stundenliste und Premium-Schalter (UI)", () => {
  let acc: FreeAccount;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    acc = await registerFreeAccount("privat", "stundenliste");

    // Assistentin + bestätigter Dienst (API-Seed → planningStatus-Default FIX)
    // + ein Urlaubstag, damit die Stundenliste beide Zeilenarten enthält.
    const userRes = await acc.ctx.post("/api/users", {
      data: {
        name: ASSISTANT_NAME,
        email: `e2e.stundenliste.${Date.now()}@dienstplan.test`,
        role: "assistant",
      },
    });
    expect(userRes.status(), "Assistentin anlegen fehlgeschlagen").toBe(201);
    const assistantId = ((await userRes.json()) as { id: number }).id;

    const shiftRes = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        startTime: `${YEAR}-${MM}-${DAY}T08:00:00.000Z`,
        endTime: `${YEAR}-${MM}-${DAY}T16:00:00.000Z`,
        type: "active",
      },
    });
    expect(shiftRes.ok(), `Dienst anlegen fehlgeschlagen (${shiftRes.status()})`).toBe(true);
  });

  test.afterAll(async () => {
    await deleteFreeAccount(acc);
  });

  test("Free: Stundenliste exportierbar, Premium-Exporte gesperrt sichtbar", async ({ page }) => {
    test.setTimeout(90_000);
    await adoptSession(page, acc);
    await page.goto("/auswertungen");
    await expect(page.getByRole("heading", { name: "Auswertungen" })).toBeVisible();

    // Free sieht den Upsell-Hinweis statt der Soll/Ist-Auswertung, aber der
    // Export-Button im Kopf bleibt aktiv (Stundenliste).
    await expect(page.getByTestId("analytics-premium-upsell")).toBeVisible();
    const exportBtn = page.getByTestId("export-popover-button");
    await expect(exportBtn).toBeEnabled();
    await exportBtn.click();

    // Stundenliste frei, Premium-Optionen gesperrt (Lock + Hinweis).
    const stundenlisteCheck = page.getByTestId("export-check-stundenliste");
    await expect(stundenlisteCheck).toBeEnabled();
    await expect(page.getByTestId("export-check-lohn")).toBeDisabled();
    await expect(page.getByTestId("export-check-zeitkonto")).toBeDisabled();
    await expect(page.getByTestId("export-check-zip")).toBeDisabled();
    await expect(page.getByTestId("export-lock-lohn")).toBeVisible();
    await expect(page.getByTestId("export-premium-hint")).toBeVisible();

    // Stundenliste auswählen und herunterladen.
    await stundenlisteCheck.click();
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByTestId("export-auswahl-button").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^stundenliste-\d{4}-\d{2}\.xlsx$/);
  });

  test("Free: die drei Premium-Schalter in den Einstellungen sind gesperrt", async ({ page }) => {
    test.setTimeout(90_000);
    await adoptSession(page, acc);
    await page.goto("/einstellungen");

    await expect(page.getByTestId("allowance-time-tracking-switch")).toBeDisabled();
    await expect(page.getByTestId("allowance-pause-auto-switch")).toBeDisabled();
    await expect(page.getByTestId("allowance-deduct-pauses-switch")).toBeDisabled();
    await expect(page.getByTestId("lock-time-tracking")).toBeVisible();
    await expect(page.getByTestId("lock-pause-auto")).toBeVisible();
    await expect(page.getByTestId("lock-deduct-pauses")).toBeVisible();
    await expect(page.getByTestId("premium-switch-hint").first()).toBeVisible();
  });

  test("Premium: Export-Optionen und Schalter bleiben unverändert bedienbar", async ({ page }) => {
    test.setTimeout(90_000);
    await setAccountPlan(acc.email, "premium");
    try {
      await adoptSession(page, acc);
      await page.goto("/einstellungen");
      await expect(page.getByTestId("allowance-time-tracking-switch")).toBeEnabled();
      await expect(page.getByTestId("allowance-pause-auto-switch")).toBeEnabled();
      await expect(page.getByTestId("allowance-deduct-pauses-switch")).toBeEnabled();

      await page.goto("/auswertungen");
      await expect(page.getByRole("heading", { name: "Auswertungen" })).toBeVisible();
      await page.getByTestId("export-popover-button").click();
      await expect(page.getByTestId("export-check-stundenliste")).toBeEnabled();
      await expect(page.getByTestId("export-check-lohn")).toBeEnabled();
      await expect(page.getByTestId("export-check-zeitkonto")).toBeEnabled();
      await expect(page.getByTestId("export-premium-hint")).toHaveCount(0);
    } finally {
      await setAccountPlan(acc.email, "free");
    }
  });
});
