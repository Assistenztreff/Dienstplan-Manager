import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginViaUi } from "./helpers/auth";
import {
  registerFreeAccount,
  deleteFreeAccount,
  setAccountPlan,
  FREE_ACCOUNT_PASSWORD,
  type FreeAccount,
} from "./helpers/teams";

/**
 * E2E fuer den Schicht-Wizard (Baustein 4, 01.09.2026): Dienste aus
 * Vorlagen-Paketen anlegen.
 *
 * Geprueft wird die Kette, an der der Wizard haengt:
 *  1. Free AM Limit: der Limit-Hinweis steht VORAB im Dialog, alle
 *     Anlegen-Knoepfe sind gesperrt — kein Fehlversuch noetig.
 *  2. Free mit einem freien Platz: die Ein-Dienst-Vorlage laesst sich
 *     anlegen, der neue Dienst traegt die Regelplan-Voreinstellung.
 *  3. Premium: das Drei-Schicht-Paket legt drei Dienste an; ein zweiter
 *     Anlauf erkennt die Doubletten und sperrt den Knopf.
 */

type ShiftModel = { id: number; name: string; imRegelplan?: boolean; standbySlot?: boolean };

let acc: FreeAccount | undefined;
let ctx: APIRequestContext;

async function modelle(): Promise<ShiftModel[]> {
  const res = await ctx.get("/api/shift-models");
  expect(res.ok()).toBe(true);
  return (await res.json()) as ShiftModel[];
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  acc = await registerFreeAccount("privat", "vorlagen");
  ctx = acc.ctx;
});

test.afterAll(async () => {
  await deleteFreeAccount(acc);
});

test.describe("Schicht-Wizard (Vorlagen)", () => {
  test("Free am Limit: Hinweis vorab, alle Vorlagen gesperrt", async ({ page }) => {
    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/einstellungen");
    await page.getByTestId("model-vorlagen").click();
    const dialog = page.getByTestId("vorlagen-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("vorlagen-limit-hinweis")).toContainText(
      "kein weiterer",
    );
    for (const key of ["rund-um-die-uhr", "drei-schicht", "zwei-schicht-12h", "werktags"]) {
      await expect(dialog.getByTestId(`vorlage-anlegen-${key}`)).toBeDisabled();
    }
    await page.keyboard.press("Escape");
  });

  test("Free mit freiem Platz: Ein-Dienst-Vorlage anlegen, Regelplan sitzt", async ({ page }) => {
    // Einen Standard-Dienst loeschen -> genau ein Platz frei.
    const vorher = await modelle();
    const opfer = vorher.find((m) => m.name === "Bereitschaft") ?? vorher[vorher.length - 1]!;
    const del = await ctx.delete(`/api/shift-models/${opfer.id}`);
    expect(del.ok(), `Dienst loeschen fehlgeschlagen (${del.status()})`).toBe(true);

    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/einstellungen");
    await page.getByTestId("model-vorlagen").click();
    const dialog = page.getByTestId("vorlagen-dialog");
    await expect(dialog.getByTestId("vorlagen-limit-hinweis")).toContainText("noch ein");
    // Drei-Schicht braucht 3 Plaetze -> weiter gesperrt; Werktags (1) geht.
    await expect(dialog.getByTestId("vorlage-anlegen-drei-schicht")).toBeDisabled();
    await dialog.getByTestId("vorlage-anlegen-werktags").click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/1 Dienste angelegt/)).toBeVisible();

    const nachher = await modelle();
    const neu = nachher.find((m) => m.name === "Tagesbegleitung");
    expect(neu, "Tagesbegleitung wurde nicht angelegt").toBeTruthy();
    expect(neu!.imRegelplan).toBe(true);
  });

  test("Premium: Drei-Schicht-Paket anlegen, Doubletten werden erkannt", async ({ page }) => {
    await setAccountPlan(acc!.email, "premium");
    await loginViaUi(page, acc!.email, FREE_ACCOUNT_PASSWORD);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/einstellungen");
    await page.getByTestId("model-vorlagen").click();
    const dialog = page.getByTestId("vorlagen-dialog");
    // Premium: kein Limit-Hinweis.
    await expect(dialog.getByTestId("vorlagen-limit-hinweis")).toHaveCount(0);
    await dialog.getByTestId("vorlage-anlegen-drei-schicht").click();
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/3 Dienste angelegt/)).toBeVisible();

    const namen = (await modelle()).map((m) => m.name);
    for (const n of ["Frühschicht", "Spätschicht", "Nachtschicht"]) {
      expect(namen).toContain(n);
    }

    // Zweiter Anlauf: alles schon da -> Knopf gesperrt, Zeilen sagen es.
    await page.getByTestId("model-vorlagen").click();
    const dialog2 = page.getByTestId("vorlagen-dialog");
    await expect(dialog2.getByTestId("vorlage-drei-schicht")).toContainText("gibt es schon");
    await expect(dialog2.getByTestId("vorlage-anlegen-drei-schicht")).toBeDisabled();
  });
});
