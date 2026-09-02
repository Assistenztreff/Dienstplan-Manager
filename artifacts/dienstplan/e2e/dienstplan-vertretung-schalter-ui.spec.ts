import { test, expect, type Page } from "@playwright/test";
import { format } from "date-fns";
import {
  registerFreeAccount,
  deleteFreeAccount,
  type FreeAccount,
} from "./helpers/teams";

/**
 * UI-Test: Der Schalter „Mit Vertretungen planen“ steuert, ob der Schicht-
 * Dialog das Feld „Vertretung vormerken“ zeigt.
 *
 * Kay-Entscheidung 30.08.2026: Im Drei-Schicht-Modell hat das Feld den Dialog
 * nur aufgebläht und wurde übersehen. Ob mit Vertretungen geplant wird, ist
 * eine Grundsatzentscheidung — einmal in den Einstellungen, nicht bei jedem
 * Dienst neu.
 *
 * Bewiesen wird aus Nutzersicht:
 *   1. AUS (Standard): der Dialog zeigt das Feld nicht.
 *   2. Schalter in den Einstellungen umlegen, speichern: der Dialog zeigt es.
 *   3. Bestandsschutz: hängt an einem Dienst schon eine Vertretung, bleibt das
 *      Feld beim Bearbeiten DIESES Dienstes sichtbar — auch bei AUS. Sonst
 *      wäre die Vormerkung nicht mehr änderbar; ein Schalter darf Bestands-
 *      daten so wenig einsperren wie löschen.
 *
 * Läuft gegen den isolierten Test-Stack (eigener API + Vite auf der `_test`-DB).
 */

const todayKey = format(new Date(), "yyyy-MM-dd");

async function adoptSession(page: Page, account: FreeAccount): Promise<void> {
  const state = await account.ctx.storageState();
  await page.context().addCookies(state.cookies);
}

/** Öffnet den Dienstplan in der Listenansicht, ganzer Monat, alles ausgeklappt. */
async function openDienstplanList(page: Page): Promise<void> {
  await page.goto("/dienstplan");
  await expect(page.getByRole("heading", { name: "Dienstplan" })).toBeVisible();
  await page.getByTestId("view-toggle-list").click();
  await page.getByTestId("schedule-list-range-menu").click();
  await page.getByRole("option", { name: "Dieser Monat" }).click();
  await page.getByTestId("schedule-list-collapse-all").click();
}

test.describe("Schalter „Mit Vertretungen planen“ (UI)", () => {
  let acc: FreeAccount;
  let assistantId = 0;
  let vertretungId = 0;

  test.beforeAll(async () => {
    acc = await registerFreeAccount("privat", "vertretung.schalter.ui");
    // Zwei Assistenzkräfte: eine für den Dienst, eine als mögliche Vertretung.
    // Mit nur einer Person hätte die Vertretungs-Auswahl keinen Eintrag.
    const unique = Date.now();
    for (const [name, key] of [
      ["Vertretung Dienst", "dienst"],
      ["Vertretung Ersatz", "ersatz"],
    ] as const) {
      const res = await acc.ctx.post("/api/users", {
        data: {
          name,
          email: `e2e.vertretung.schalter.${key}.${unique}@dienstplan.test`,
          role: "assistant",
        },
      });
      expect(res.status(), `Assistenzkraft ${name}: ${await res.text()}`).toBe(201);
      const id = ((await res.json()) as { id: number }).id;
      if (key === "dienst") assistantId = id;
      else vertretungId = id;
    }
  });

  test.afterAll(async () => {
    await deleteFreeAccount(acc);
  });

  test("AUS (Standard): der Schicht-Dialog zeigt kein Vertretungs-Feld", async ({ page }) => {
    test.setTimeout(60000);
    await adoptSession(page, acc);
    await openDienstplanList(page);

    await page.getByTestId(`agenda-day-${todayKey}`).locator("button").first().click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog.getByText("Neue Schicht anlegen")).toBeVisible();

    // Der Dialog ist da und zeigt seine normalen Felder — nur das
    // Vertretungs-Feld fehlt. Die Pause dient als Anker, dass der Bereich
    // unterhalb der Zeiten überhaupt gerendert ist.
    await expect(dialog.getByTestId("shift-dialog-pause")).toBeVisible();
    await expect(dialog.getByTestId("shift-dialog-standby")).toHaveCount(0);
  });

  test("Schalter in den Einstellungen umlegen: der Dialog zeigt das Feld", async ({ page }) => {
    test.setTimeout(90000);
    await adoptSession(page, acc);

    await page.goto("/einstellungen");
    await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();

    const schalter = page.getByTestId("allowance-vertretung-enabled-switch");
    await expect(schalter).toBeVisible();
    await expect(schalter, "Startzustand AUS").toHaveAttribute("aria-checked", "false");
    // Die Vergütung ist eine Folgefrage — ohne Vertretungen nicht zu sehen.
    await expect(page.getByTestId("allowance-vertretung-compensation-mode-select")).toHaveCount(0);

    await schalter.click();
    await expect(schalter).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByTestId("allowance-vertretung-compensation-mode-select"),
      "Mit Vertretungen erscheint direkt darunter die Vergütung",
    ).toBeVisible();

    await page.getByTestId("allowance-save-button").click();
    // Serverseitig angekommen? Nicht nur der Toast — die API muss es sagen.
    await expect
      .poll(async () => {
        const res = await acc.ctx.get("/api/allowance-settings");
        return ((await res.json()) as { vertretungEnabled: boolean }).vertretungEnabled;
      }, { message: "Der Schalter muss gespeichert sein" })
      .toBe(true);

    await openDienstplanList(page);
    await page.getByTestId(`agenda-day-${todayKey}`).locator("button").first().click();
    const dialog = page.getByTestId("shift-dialog");
    await expect(dialog.getByText("Neue Schicht anlegen")).toBeVisible();
    await expect(dialog.getByTestId("shift-dialog-standby")).toBeVisible();
  });

  test("Bestandsschutz: ein Dienst mit vorgemerkter Vertretung bleibt auch bei AUS bearbeitbar", async ({
    page,
  }) => {
    test.setTimeout(90000);

    // Dienst MIT Vertretung anlegen, solange der Schalter AN ist ...
    const on = await acc.ctx.put("/api/allowance-settings", { data: { vertretungEnabled: true } });
    expect(on.ok(), await on.text()).toBe(true);
    const shiftRes = await acc.ctx.post("/api/shifts", {
      data: {
        userId: assistantId,
        standbyUserId: vertretungId,
        type: "work",
        startTime: `${todayKey}T08:00:00.000Z`,
        endTime: `${todayKey}T12:00:00.000Z`,
      },
    });
    expect(shiftRes.status(), await shiftRes.text()).toBe(201);
    const shiftId = ((await shiftRes.json()) as { id: number }).id;

    // ... dann den Schalter wieder AUS.
    const off = await acc.ctx.put("/api/allowance-settings", { data: { vertretungEnabled: false } });
    expect(off.ok(), await off.text()).toBe(true);

    await adoptSession(page, acc);
    await openDienstplanList(page);

    // Neu anlegen: kein Feld (AUS gilt).
    await page.getByTestId(`agenda-day-${todayKey}`).locator("button").first().click();
    const neu = page.getByTestId("shift-dialog");
    await expect(neu.getByText("Neue Schicht anlegen")).toBeVisible();
    await expect(neu.getByTestId("shift-dialog-standby")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(neu).toHaveCount(0);

    // Bestehenden Dienst bearbeiten: Feld da, Vertretung vorbelegt.
    const badge = page.getByTestId("schedule-list").getByTestId(`shift-badge-${shiftId}`);
    await expect(badge).toBeVisible();
    await badge.click();
    const edit = page.getByTestId("shift-dialog");
    await expect(edit.getByText("Schicht bearbeiten")).toBeVisible();
    const standby = edit.getByTestId("shift-dialog-standby");
    await expect(standby, "Die Vormerkung darf nicht eingesperrt sein").toBeVisible();
    await expect(standby).toContainText("Vertretung Ersatz");
  });
});
